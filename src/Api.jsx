import { format } from "date-fns";
import { sl } from "date-fns/locale";

const busStopsLink =
	"https://raw.githubusercontent.com/jakecernet/ijpp-json/refs/heads/main/unified_stops_with_gtfs.json";

const lppLocationsLink =
	"https://mestnipromet.cyou/api/v1/resources/buses/info";
const ijppLocationsLink = "https://api.beta.brezavta.si/vehicles/locations";

const ijppArrivalsLink = "https://api.beta.brezavta.si/stops/";
const lppArrivalsLink =
	"https://tracker.cernetic.cc/api/lpp-arrivals?station-code=";
const lppRouteLink = "https://tracker.cernetic.cc/api/lpp-route?trip-id=";
const lppRoutePointsLink =
	"https://tracker.cernetic.cc/api/lpp-route-points?route-id=";
const ijppRouteLink = "https://api.beta.brezavta.si/trips/";
const szRouteLink =
	"https://mapper-motis.ojpp-gateway.derp.si/api/v2/trip?tripId=";
const szArrivalsLink =
	"https://mapper-motis.ojpp-gateway.derp.si/api/v1/stoptimes?stopId=";

const szStopsLink =
	"https://raw.githubusercontent.com/jakecernet/ijpp-json/refs/heads/main/sz_stops.json";

function buildSzLocationsLink() {
	const now = new Date();
	const later = new Date(now.getTime() + 60000);
	return `https://mapper-motis.ojpp-gateway.derp.si/api/v1/map/trips?min=49.415360776528956%2C7.898969151846785&max=36.38523043114108%2C26.9347879737411&startTime=${encodeURIComponent(
		now.toISOString(),
	)}&endTime=${encodeURIComponent(later.toISOString())}&zoom=20`;
}

/**
 * Univerzalni objekt izbrane rute
 * @type {Object}
 */
let selectedRoute = {
	tripId: "",
	tripName: "",
	operator: "",
	stops: [],
	geometry: [],
	isLPP: false,
	isSZ: false,
};

/**
 * Helper za fetchanje JSON podatkov
 * @param {*} url - Link
 * @returns JSON s podatki
 */
async function fetchJson(url) {
	const response = await fetch(url);
	if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
	return response.json();
}

const cache = new Map();

const CACHE_TTL = {
	stops: 5 * 60 * 1000,
	positions: 2.5 * 1000,
	arrivals: 15 * 1000,
	routes: 5 * 60 * 1000,
};

const routeCache = new Map();
const routeInFlight = new Map();

function getCachedRoute(tripId) {
	const cached = routeCache.get(tripId);
	if (cached && Date.now() - cached.time < CACHE_TTL.routes) {
		return cached.data;
	}
	return null;
}

function setCachedRoute(tripId, data) {
	if (tripId && data) {
		routeCache.set(tripId, { data, time: Date.now() });
	}
}
const inFlight = new Map();

/**
 * Helper za fetchanje s cachingom
 * @returns
 */
async function cachedFetch(key, ttl, fetcher) {
	const cached = cache.get(key);
	if (cached && Date.now() - cached.time < ttl) return cached.data;

	if (inFlight.has(key)) return inFlight.get(key);

	const promise = (async () => {
		try {
			const data = await fetcher();
			cache.set(key, { data, time: Date.now() });
			return data;
		} finally {
			inFlight.delete(key);
		}
	})();

	inFlight.set(key, promise);
	return promise;
}

/** Pretvori sekunde od polnoči v časovni format HH:MM:SS
 * @param {number} seconds - Sekunde od polnoči
 * @returns Čas v formatu HH:MM:SS
 */
function seconds2time(seconds) {
	const hour = `${Math.floor(seconds / 3600)}`.padStart(2, "0");
	const minute = `${Math.floor((seconds % 3600) / 60)}`.padStart(2, "0");
	const second = `${seconds % 60}`.padStart(2, "0");
	return `${hour}:${minute}:${second}`;
}

/**
 * Formatira čas v obliko HH:mm
 * @param {Date|string} arrivalTime - Čas prihoda
 * @returns Čas v formatu HH:mm ali N/A
 */
export function formatTime(arrivalTime) {
	if (!arrivalTime) return "N/A";
	try {
		const date = new Date(arrivalTime);
		if (isNaN(date.getTime())) return "N/A";
		return format(date, "HH:mm", { locale: sl });
	} catch {
		return "N/A";
	}
}

/**
 * Formatira prihod z ETA minutami in časom
 * @param {Object} arrival - Podatki o prihodu
 * @returns {Object} Objekt s etaMinutes in arrivalTime (HH:mm format)
 */
function computeEtaAndTime(arrival) {
	let etaMin = arrival.etaMinutes ?? arrival.eta_min ?? undefined;
	let actualTime =
		arrival.realtimeDeparture ||
		arrival.actualDeparture ||
		arrival.scheduledDeparture ||
		arrival.estimated_arrival_time ||
		arrival.arrival_time ||
		arrival.realtimeArrival ||
		arrival.scheduledArrival;

	let actualDate = null;
	if (actualTime) {
		actualDate = new Date(actualTime);
		// If parsing failed or if it looks like a time-only string, try prepending today's date
		if (
			isNaN(actualDate.getTime()) &&
			typeof actualTime === "string" &&
			actualTime.match(/^\d{2}:\d{2}(:\d{2})?$/)
		) {
			const today = new Date().toISOString().split("T")[0];
			actualDate = new Date(`${today}T${actualTime}`);
		}
	}
	if (actualDate && isNaN(actualDate.getTime())) {
		actualDate = null;
	}

	if (etaMin === undefined && actualDate) {
		const now = new Date();
		etaMin = Math.max(
			0,
			Math.round((actualDate.getTime() - now.getTime()) / 60000),
		);
	}

	if (!actualDate && etaMin !== undefined) {
		actualDate = new Date(new Date().getTime() + etaMin * 60000);
	}

	const timeStr = actualDate ? formatTime(actualDate) : "N/A";
	return {
		etaMinutes: etaMin ?? undefined,
		arrivalTime: timeStr,
	};
}

/**
 * Formatira prihod s pre-computed ETA minutami in časom
 * @param {Object} arrival - Podatki o prihodu s etaMinutes in arrivalTime
 * @returns Niz v obliki "X min (HH:mm)"
 */
export function formatPrecomputedArrival(arrival) {
	const etaMin = arrival.etaMinutes ?? "?";
	const timeStr = arrival.arrivalTime ?? "N/A";
	let etaDisplay;
	if (typeof etaMin === "number" && etaMin >= 60) {
		const hours = Math.floor(etaMin / 60);
		const minutes = etaMin % 60;
		etaDisplay = `${hours}h ${minutes}m`;
	} else {
		etaDisplay = `${etaMin} min`;
	}
	return `${etaDisplay} \n(${timeStr})`;
}

/**
 * Helper za dekodirat routo vlaka iz polylina
 * @param {string} polyline - Polyline tekst
 * @param {Array} points - Tabelo točk
 */
function decodePolylineOnce(str, precision) {
	const factor = Math.pow(10, precision);
	let index = 0;
	let lat = 0;
	let lng = 0;
	const pts = [];
	while (index < str.length) {
		let result = 0;
		let shift = 0;
		let byte;
		do {
			byte = str.charCodeAt(index++) - 63;
			result |= (byte & 0x1f) << shift;
			shift += 5;
		} while (byte >= 0x20);
		const dlat = result & 1 ? ~(result >> 1) : result >> 1;
		lat += dlat;

		result = 0;
		shift = 0;
		do {
			byte = str.charCodeAt(index++) - 63;
			result |= (byte & 0x1f) << shift;
			shift += 5;
		} while (byte >= 0x20);
		const dlng = result & 1 ? ~(result >> 1) : result >> 1;
		lng += dlng;

		pts.push([lng / factor, lat / factor]);
	}
	return pts;
}

/**
 * Še en helper
 */
function isValidCoord([lon, lat]) {
	return (
		Number.isFinite(lat) &&
		Number.isFinite(lon) &&
		Math.abs(lat) <= 90 &&
		Math.abs(lon) <= 180
	);
}

/**
 * Dejanska helper funkcija za dekodiranje polylina
 **/
export function decodePolylineToPoints(str, precision) {
	if (!str || typeof str !== "string") return [];
	let pts = decodePolylineOnce(str, precision);
	// If decoded points look implausible (e.g., 3 digits before decimal), try precision+1 (common 1e6 factor)
	const first = pts[0];
	if (!first || !isValidCoord(first)) {
		const alt = decodePolylineOnce(str, precision + 1);
		if (alt[0] && isValidCoord(alt[0])) pts = alt;
	}
	return pts.filter(isValidCoord);
}

/**
 *  Fetcha vse bus postaje
 *  @returns Tabelo vseh bus postaj
 */
const fetchAllBusStops = async () => {
	try {
		const raw = await cachedFetch(busStopsLink, CACHE_TTL.stops, () =>
			fetchJson(busStopsLink),
		);
		const list = Array.isArray(raw) ? raw : [];

		return list
			.map((stop) => {
				const latitude = stop.latitude ?? null;
				const longitude = stop.longitude ?? null;
				const gpsLocation = [latitude, longitude];
				const vCenter = stop.ref_id % 2 === 1 ? true : false;
				if (
					!Number.isFinite(gpsLocation?.[0]) ||
					!Number.isFinite(gpsLocation?.[1])
				) {
					return null;
				}

				return {
					...stop,
					name: stop.name ?? "",
					gpsLocation,
					coordinates: gpsLocation,
					ref_id: stop.ref_id ?? null,
					gtfs_id: stop.gtfs_id ?? null,
					ijpp_id: stop.ijpp_id ?? null,
					routes_on_stop: stop.route_groups_on_station ?? [],
					vCenter: stop.ref_id ? vCenter : null,
				};
			})
			.filter(Boolean);
	} catch (error) {
		console.error("Error fetching bus stops:", error);
		return [];
	}
};

/**
 * Fetcha postaje vlakov
 * @returns Tabelo s postajami
 */
const fetchSzStops = async () => {
	try {
		return await cachedFetch(szStopsLink, CACHE_TTL.stops, () =>
			fetchJson(szStopsLink),
		);
	} catch (error) {
		console.error("Error fetching SZ stops:", error);
		return [];
	}
};

/**
 * Fetcha LPP bus pozicije
 * @returns Tabela z LPP pozicijami
 */
const fetchLPPPositions = async () => {
	try {
		const data = await cachedFetch(
			lppLocationsLink,
			CACHE_TTL.positions,
			() => fetchJson(lppLocationsLink),
		);

		return data.data.map((bus) => ({
			gpsLocation: [bus.latitude, bus.longitude],
			operator: "Ljubljanski potniški promet d.o.o.",
			lineNumber: bus.line_number,
			lineId: bus.line_id,
			lineName: bus.line_name,
			lineDestination: bus.line_destination,
			speed: bus.speed,
			busName: bus.bus_name,
			ignition: bus.ignition,
			tripId: bus.trip_id,
		}));
	} catch (error) {
		console.error("Error fetching lpp positions:", error);
	}
};

/**
 * Fetcha IJPP podatke o vozilih
 * @returns Tabelo z IJPP pozicijami in routami ('stops' lastnost)
 */
const fetchIJPPPositions = async () => {
	try {
		const data = await cachedFetch(
			ijppLocationsLink,
			CACHE_TTL.positions,
			() => fetchJson(ijppLocationsLink),
		);
		return Array.isArray(data)
			? data
					.filter(
						(vehicle) =>
							vehicle?.vehicle?.operator_name !=
								"Ljubljanski Potniški Promet" &&
							vehicle?.vehicle?.operator_name !=
								"Ljubljanski potniški promet" &&
							vehicle?.vehicle?.operator_name !=
								"Ljubljanski potniški promet, d.o.o." &&
							vehicle?.vehicle?.operator_name !==
								"Slovenske železnice",
					)
					.map((vehicle) => ({
						gpsLocation: [vehicle?.lat || 0, vehicle?.lon || 0],
						heading: vehicle?.heading || 0,
						operator: vehicle?.vehicle?.operator_name || "/",
						lineName: vehicle?.trip_headsign,
						tripId: vehicle?.trip_id,
						vehicleId: vehicle?.vehicle?.id,
						stop: vehicle?.stop?.name ?? "/",
						stopStatus: vehicle?.stop_status,
					}))
			: [];
	} catch (error) {
		console.error("Error fetching ijpp positions:", error);
	}
};

/**
 * Fetcha pozicije vlakov
 * @returns Tabelo s pozicijami vlakov (vključno s celotno potjo za animacijo)
 */
const fetchTrainPositions = async () => {
	try {
		const data = await fetchJson(buildSzLocationsLink());
		const filteredData = data.filter(
			(train) => train.routeColor === "29ace2",
		);

		const fmtTime = (iso) => (iso ? format(new Date(iso), "HH:mm") : "?");

		const haversine = (c1, c2) => {
			const R = 6371000;
			const toRad = (d) => (d * Math.PI) / 180;
			const dLat = toRad(c2[1] - c1[1]);
			const dLon = toRad(c2[0] - c1[0]);
			const a =
				Math.sin(dLat / 2) ** 2 +
				Math.cos(toRad(c1[1])) *
					Math.cos(toRad(c2[1])) *
					Math.sin(dLon / 2) ** 2;
			return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
		};

		return filteredData
			.filter((train) => train.trips?.[0]?.tripId)
			.map((train) => {
				const coords = decodePolylineOnce(train.polyline, 5);
				const departure = new Date(train.departure).getTime();
				const arrival = new Date(train.arrival).getTime();
				const scheduledDeparture = new Date(
					train.scheduledDeparture,
				).getTime();
				const scheduledArrival = new Date(
					train.scheduledArrival,
				).getTime();
				const delay = Math.max(
					departure - scheduledDeparture,
					arrival - scheduledArrival,
				);

				// Zgradi pot s časovnimi žigi
				let path = [];
				if (coords && coords.length >= 2) {
					let totalDist = 0;
					const dists = [0];
					for (let i = 1; i < coords.length; i++) {
						totalDist += haversine(coords[i - 1], coords[i]);
						dists.push(totalDist);
					}
					if (totalDist > 0) {
						const adjDep = departure + delay;
						const duration = arrival + delay - adjDep;
						path = coords.map((coord, i) => ({
							coord,
							time: adjDep + (dists[i] / totalDist) * duration,
						}));
					}
				}

				return {
					gpsLocation: coords[0],
					path,
					from: train.from,
					to: train.to,
					realtime: train.realTime,
					departure: fmtTime(train.scheduledDeparture),
					arrival: fmtTime(train.scheduledArrival),
					tripId: train.trips[0]?.tripId,
					tripShort:
						train.trips[0].routeShortName?.split(" ").join("") ||
						"?",
					delay,
				};
			});
	} catch (error) {
		console.error("Error fetching train positions:", error);
		return [];
	}
};

/**
 * Interpolira pozicijo vlaka na poti glede na trenutni čas
 * @param {Array} path - Pot s časovnimi žigi
 * @param {number} now - Trenutni čas (timestamp)
 * @returns {Object} { coord: [lon, lat], bearing: number }
 */
function getInterpolatedPosition(path, now) {
	if (!path || path.length === 0) {
		return { coord: [0, 0], bearing: 0 };
	}

	const calcBearing = (from, to) => {
		const toRad = (d) => (d * Math.PI) / 180;
		const toDeg = (r) => (r * 180) / Math.PI;
		const dLon = toRad(to[0] - from[0]);
		const lat1 = toRad(from[1]);
		const lat2 = toRad(to[1]);
		const x = Math.sin(dLon) * Math.cos(lat2);
		const y =
			Math.cos(lat1) * Math.sin(lat2) -
			Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
		return (toDeg(Math.atan2(x, y)) + 360) % 360;
	};

	// Pred odhodom
	if (now <= path[0].time) {
		const bearing =
			path.length > 1 ? calcBearing(path[0].coord, path[1].coord) : 0;
		return { coord: path[0].coord, bearing };
	}

	// Po prihodu
	if (now >= path[path.length - 1].time) {
		const bearing =
			path.length > 1
				? calcBearing(
						path[path.length - 2].coord,
						path[path.length - 1].coord,
					)
				: 0;
		return { coord: path[path.length - 1].coord, bearing };
	}

	// Najdi segment
	for (let i = 1; i < path.length; i++) {
		if (now <= path[i].time) {
			const prev = path[i - 1];
			const curr = path[i];
			const t = (now - prev.time) / (curr.time - prev.time);
			const coord = [
				prev.coord[0] + (curr.coord[0] - prev.coord[0]) * t,
				prev.coord[1] + (curr.coord[1] - prev.coord[1]) * t,
			];
			return { coord, bearing: calcBearing(prev.coord, curr.coord) };
		}
	}

	return { coord: path[path.length - 1].coord, bearing: 0 };
}

/**
 *  Fetcha IJPP trip
 * @param {string} tripId - ID tripa
 * @returns Podrobnosti o tripu
 */
const fetchIJPPTrip = async (trip) => {
	if (!trip) return null;
	const tripId = trip.tripId || trip;

	const operator =
		(typeof trip === "object" && (trip.operatorName || trip.operator)) ||
		"";
	const cached = getCachedRoute(tripId);
	if (cached) return cached;

	if (routeInFlight.has(tripId)) return routeInFlight.get(tripId);

	const promise = (async () => {
		try {
			const dateString = new Date().toISOString().split("T")[0];
			const raw = await fetchJson(
				ijppRouteLink + tripId + `?date=${dateString}`,
			);
			const pointsResponse = await fetchJson(
				ijppRouteLink + tripId + "/geometry",
			);

			selectedRoute = {
				tripName: raw?.trip_headsign || "",
				tripId: raw?.gtfs_id || "",
				stops: raw?.stop_times
					? raw.stop_times.map((stop) => ({
							arrival: seconds2time(stop.arrival_realtime),
							departure: seconds2time(stop.departure_realtime),
							realtime: stop.realtime,
							passed: stop.passed,
							name: stop.stop.name,
							gtfsId: stop.stop.gtfs_id,
							gpsLocation: [
								stop.stop.lat ?? null,
								stop.stop.lon ?? null,
							],
						}))
					: [],
				geometry: pointsResponse.coordinates || [],
				operator,
				isLPP: false,
				isSZ: false,
			};
			setCachedRoute(tripId, selectedRoute);
			return selectedRoute;
		} catch (error) {
			console.error("Error fetching IJPP trip:", error);
			return null;
		} finally {
			routeInFlight.delete(tripId);
		}
	})();

	routeInFlight.set(tripId, promise);
	return promise;
};

/** Fetcha točke LPP route
 * @param {string} routeId - ID route
 * @param {string} tripId - Optional trip ID to filter by specific trip
 * @returns Tabelo s točkami route
 */
const fetchLppPoints = async (routeId, tripId = null) => {
	if (!routeId) return null;
	try {
		const raw = await fetchJson(lppRoutePointsLink + routeId);
		let data = raw.data?.filter((point) => point.geojson_shape != null);

		// If tripId is provided, filter to only include that specific trip's geometry
		if (tripId && data) {
			const matchingTrip = data.find((point) => point.trip_id === tripId);
			data = [matchingTrip || data[0]].filter(Boolean);
		} else if (data?.length > 0) {
			data = [data[0]];
		}

		const points = data
			?.map((point) => {
				if (!point.geojson_shape?.type) return null;
				return {
					tripId: point.trip_id,
					routeNumber: point.route_number,
					routeName: point.route_name,
					points:
						point.geojson_shape.type === "LineString"
							? point.geojson_shape.coordinates.map((coord) => [
									coord[1],
									coord[0],
								])
							: point.geojson_shape.type === "MultiLineString"
								? point.geojson_shape.coordinates
										.reduce(
											(longest, seg) =>
												seg.length > longest.length
													? seg
													: longest,
											[],
										)
										.map((coord) => [coord[1], coord[0]])
								: [],
				};
			})
			.filter(Boolean);
		return points?.length > 0 ? points : null;
	} catch (error) {
		console.error("Error fetching LPP route points:", error);
		return null;
	}
};

/**
 * Fetcha LPP routo za določen trip ID (preko proxyja za https://data.lpp.si/api/route/arrivals-on-route)
 * @param {string} tripId - ID tripa
 * @returns Postaje na poti in prihode na posamezne postaje
 */
const fetchLppRoute = async (lppRoute) => {
	if (!lppRoute) return null;
	const cached = getCachedRoute(lppRoute.tripId);
	if (cached) return cached;

	if (routeInFlight.has(lppRoute.tripId))
		return routeInFlight.get(lppRoute.tripId);

	const promise = (async () => {
		try {
			const raw = await fetchJson(lppRouteLink + lppRoute.tripId);
			const geometry = await fetchLppPoints(
				lppRoute.lineId || lppRoute.routeId,
				lppRoute.tripId,
			);

			const lineNumber = lppRoute.lineNumber || lppRoute.routeName || "";
			const tripName = lppRoute.lineName || lppRoute.tripName || "";

			selectedRoute = {
				isLPP: true,
				isSZ: false,
				tripId: lppRoute.tripId || "",
				tripName: tripName,
				lineNumber: lineNumber,
				operator: "Javno podjetje Ljubljanski potniški promet d.o.o.",
				stops: Array.isArray(raw.data)
					? raw.data.map((stop) => ({
							name: stop.name || "",
							stopId: stop.station_code || "",
							gpsLocation: [
								stop.latitude ?? null,
								stop.longitude ?? null,
							],
							arrivals: stop?.arrivals.map((arrival) => ({
								eta_min: arrival.eta_min,
							})),
						}))
					: [],
				geometry: geometry || [],
			};
			setCachedRoute(lppRoute.tripId, selectedRoute);
			return selectedRoute;
		} catch (error) {
			console.error("Error fetching LPP route:", error);
			return null;
		} finally {
			routeInFlight.delete(lppRoute.tripId);
		}
	})();

	routeInFlight.set(lppRoute.tripId, promise);
	return promise;
};

/**
 * Fetcha pot SZ linije
 * @param {string} tripId - ID poti
 * @returns Podrobnosti o routi vlaka
 */
const fetchSzTrip = async (tripId) => {
	if (!tripId) return null;
	const cached = getCachedRoute(tripId);
	if (cached) return cached;

	if (routeInFlight.has(tripId)) return routeInFlight.get(tripId);

	const promise = (async () => {
		try {
			const fetched = await fetchJson(szRouteLink + tripId);
			const raw = fetched?.legs || null;
			const startStop = raw?.[0]?.from ?? null;
			const endStop = raw?.[0]?.to ?? null;
			selectedRoute = Array.isArray(raw)
				? {
						from: {
							name: raw[0]?.from?.name || "",
							stopId: raw[0]?.from?.stopId || "",
							gpsLocation: [
								raw[0]?.from?.lat ?? null,
								raw[0]?.from?.lon ?? null,
							],
							departure: raw[0]?.from?.departure || "",
						},
						to: {
							name: raw[0]?.to?.name || "",
							stopId: raw[0]?.to?.stopId || "",
							gpsLocation: [
								raw[0]?.to?.lat ?? null,
								raw[0]?.to?.lon ?? null,
							],
							arrival: raw[0]?.to?.arrival || "",
						},
						tripName: raw[0]?.headsign || "",
						duration: raw[0]?.duration || "",
						startTime: raw[0]?.startTime || "",
						endTime: raw[0]?.endTime || "",
						realTime: raw[0]?.realTime || false,
						tripId: raw[0]?.tripId || "",
						tripShort: raw[0]?.routeShortName || "",
						brand: "sz",
						stops: [
							startStop,
							...(raw[0]?.intermediateStops?.map((stop) => ({
								name: stop?.name || "",
								stopId: stop?.stopId || "",
								gpsLocation: [
									stop?.lat ?? null,
									stop?.lon ?? null,
								],
								arrival: stop?.arrival || "",
								departure: stop?.departure || "",
							})) || []),
							endStop,
						],
						geometry: raw[0]?.legGeometry
							? decodePolylineToPoints(
									raw[0]?.legGeometry?.points || "",
									6,
								)
							: [],
						operator: "Slovenske železnice d.o.o.",
						isLPP: false,
						isSZ: true,
					}
				: null;
			setCachedRoute(tripId, selectedRoute);
			return selectedRoute;
		} catch (error) {
			console.error("Error fetching SZ trip:", error);
			return null;
		} finally {
			routeInFlight.delete(tripId);
		}
	})();

	routeInFlight.set(tripId, promise);
	return promise;
};

/**
 * Fetcha LPP prihode za dano postajo (preko proxyja za https://data.lpp.si/api/station/arrival)
 * @param {string} stationCode - ID postaje
 * @returns Tabelo prihodov
 */
const fetchLppArrivals = async (stationCode) => {
	if (!stationCode) return [];
	try {
		const raw = await fetchJson(lppArrivalsLink + stationCode);
		const list = Array.isArray(raw?.data?.arrivals)
			? raw.data.arrivals
			: [];
		return list
			.map((arrival) => {
				const etaData = computeEtaAndTime({
					etaMinutes: arrival.eta_min,
				});
				return {
					etaMinutes: etaData.etaMinutes,
					arrivalTime: etaData.arrivalTime,
					routeName: arrival.route_name,
					tripName: arrival.trip_name,
					routeId: arrival.route_id,
					tripId: arrival.trip_id,
					vehicleId: arrival.vehicle_id,
					type: arrival.type,
					depot: arrival.depot,
                    operatorName: "Ljubljanski potniški promet d.o.o.",
				};
			})
			.sort((a, b) => (a.etaMinutes ?? 999) - (b.etaMinutes ?? 999));
	} catch (error) {
		console.error("Error fetching LPP arrivals:", error);
		return [];
	}
};

/**
 * Fetcha IJPP prihode za dano IJPP postajo
 * @param {string} ijppId - ID IJPP postaje
 * @returns Tabelo prihodov
 */
const fetchIjppArrivals = async (ijppId) => {
	if (!ijppId) return [];
	try {
		const raw = await fetchJson(
			ijppArrivalsLink + ijppId + "?current=true",
		);
		const list = Array.isArray(raw?.arrivals) ? raw.arrivals : [];
		return list.map((arrival) => {
			const etaData = computeEtaAndTime({
				etaMinutes: undefined,
				realtimeDeparture: seconds2time(arrival?.departure_realtime),
				scheduledDeparture: seconds2time(arrival?.departure_scheduled),
			});
			return {
				operatorName: arrival?.agency_name,
				tripName: arrival?.trip_headsign,
				passed: arrival?.passed,
				realTime: arrival?.realtime,
				scheduledArrival: seconds2time(arrival?.arrival_scheduled),
				realtimeArrival: seconds2time(arrival?.arrival_realtime),
				arrivalDelay: arrival?.arrival_delay,
				scheduledDeparture: seconds2time(arrival?.departure_scheduled),
				realtimeDeparture: seconds2time(arrival?.departure_realtime),
				departureDelay: arrival?.departure_delay,
				tripId: arrival?.trip_id,
				routeId: arrival?.route_id,
				routeShortName: arrival?.route_short_name,
				etaMinutes: etaData.etaMinutes,
				arrivalTime: etaData.arrivalTime,
			};
		});
	} catch (error) {
		console.error("Error fetching IJPP arrivals:", error);
		return [];
	}
};

/**
 * Fetcha naslednjih 100 prihodov za izbrano železniško postajo
 * @returns Tabelo prihodov
 */
const fetchSzArrivals = async (stationCode) => {
	if (!stationCode) return [];
	try {
		const url = szArrivalsLink + `${encodeURIComponent(stationCode)}&n=100`;
		const raw = await fetchJson(url);

		// Get today's date in YYYY-MM-DD format
		const today = new Date().toISOString().split("T")[0];
		const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000)
			.toISOString()
			.split("T")[0];

		return (raw?.stopTimes || [])
			.filter((arrival) => {
				const scheduledDeparture = arrival?.place?.scheduledDeparture;
				return scheduledDeparture?.split("T")[0] === tomorrow;
			})
			.map((arrival) => {
				const place = arrival?.place;
				const realTime = arrival?.realTime || false;

				const scheduledArrival = place?.scheduledArrival;
				const scheduledDeparture = place?.scheduledDeparture;
				const actualArrival = place?.arrival;
				const actualDeparture = place?.departure;

				let arrivalDelay = 0;
				let departureDelay = 0;
				if (realTime && actualDeparture && scheduledDeparture) {
					departureDelay =
						new Date(actualDeparture) -
						new Date(scheduledDeparture);
				}
				if (realTime && actualArrival && scheduledArrival) {
					arrivalDelay =
						new Date(actualArrival) - new Date(scheduledArrival);
				}

				const etaData = computeEtaAndTime({
					realtimeArrival: realTime ? actualArrival : null,
					scheduledArrival,
					realtimeDeparture: realTime ? actualDeparture : null,
					scheduledDeparture,
				});

				return {
					headsign: arrival?.headsign,
					tripId: arrival?.tripId,
					routeShortName: arrival?.routeShortName,
					realTime,
					scheduledArrival,
					scheduledDeparture,
					realtimeArrival: realTime ? actualArrival : null,
					realtimeDeparture: realTime ? actualDeparture : null,
					arrivalDelay,
					departureDelay,
					etaMinutes: etaData.etaMinutes,
					arrivalTime: etaData.arrivalTime,
                    operatorName: "Slovenske železnice d.o.o.",
				};
			});
	} catch (error) {
		console.error("Error fetching SZ arrivals:", error);
		return [];
	}
};

export { fetchLPPPositions, fetchIJPPPositions, fetchTrainPositions };
export { fetchLppArrivals, fetchIjppArrivals, fetchLppRoute, fetchIJPPTrip };
export { fetchSzStops, fetchSzTrip, fetchSzArrivals };
export { fetchAllBusStops };
export { getInterpolatedPosition };
