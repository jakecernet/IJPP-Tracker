import React, {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import {
	DEFAULT_CENTER,
	DEFAULT_ZOOM,
	ICON_SOURCES,
	operatorToIcon,
	OSM_STYLE_DARK,
	OSM_STYLE_LIGHT,
} from "./map/config";
import {
	toGeoJSONPoints,
	ensureIcons,
	stopsToFeatures,
	parseTrainCoord,
	getStopCoord,
} from "./map/utils";
import {
	setupSourcesAndLayers,
	updateSourceData,
	setPrefixVisible,
	setupTripOverlay,
	clearTripOverlay,
	updateTripOverlay,
	BRAND_COLOR_EXPR,
} from "./map/layers";
import {
	configureBusStopPopup,
	configureTrainStopPopup,
	configureTrainPopup,
	configureBusPopup,
	configureTripStopsPopup,
} from "./map/interactions";
import RouteTab from "./route.jsx";

import userPNG from "../img/user.png";
import locationPNG from "../img/location.png";

const getMapStyle = () => {
	if (typeof window === "undefined") return OSM_STYLE_LIGHT;
	return localStorage.getItem("mapTheme") === "dark"
		? OSM_STYLE_DARK
		: OSM_STYLE_LIGHT;
};

function refreshMarker({ map, markersRef, key, coords, img, size, popup }) {
	const markerState = markersRef.current[key];
	if (!coords) {
		markerState?.marker?.remove();
		markersRef.current[key] = null;
		return;
	}

	const lngLat = [coords[1], coords[0]];
	if (markerState?.marker) {
		if (
			markerState.coords?.[0] === lngLat[0] &&
			markerState.coords?.[1] === lngLat[1]
		) {
			return;
		}
		markerState.marker.setLngLat(lngLat);
		markerState.coords = lngLat;
		return;
	}

	const element = document.createElement("img");
	element.src = img;
	element.alt = popup || "";
	element.decoding = "async";
	element.style.width = `${size[0]}px`;
	element.style.height = `${size[1]}px`;
	element.style.transform = "translate(-50%, -100%)";

	const marker = new maplibregl.Marker({ element, anchor: "bottom" })
		.setLngLat(lngLat)
		.addTo(map);

	if (popup) {
		marker.setPopup(
			new maplibregl.Popup({ closeButton: false }).setHTML(
				`<h4>${popup}</h4>`,
			),
		);
		element.style.cursor = "pointer";
	}

	markersRef.current[key] = { marker, coords: lngLat };
}

const Map = React.memo(function Map({
	gpsPositions,
	busStops,
	trainStops = [],
	activeStation,
	setActiveStation,
	userLocation,
	trainPositions,
	setSelectedVehicle,
	selectedVehicle,
	routeLoading,
	visibility,
	busOperators,
	isActive = true,
}) {
	const mapRef = useRef(null);
	const mapInstanceRef = useRef(null);
	const markersRef = useRef({ user: null, active: null });
	const handlersRef = useRef({
		setActiveStation,
		setSelectedVehicle,
	});
	const routeDrawerRef = useRef(null);
	const initialCenterRef = useRef(
		userLocation || activeStation?.coordinates || DEFAULT_CENTER,
	);

	useEffect(() => {
		if (!isActive) return;
		const map = mapInstanceRef.current;
		if (!map) return;
		const id = requestAnimationFrame(() => map.resize());
		return () => cancelAnimationFrame(id);
	}, [isActive]);

	const [filterByRoute, setFilterByRoute] = useState(false);
	const [routeDrawerOpen, setRouteDrawerOpen] = useState(false);
	const [routeDrawerSnap, setRouteDrawerSnap] = useState("peek");
	const [routeDrawerHeight, setRouteDrawerHeight] = useState(0);
	const [routeDrawerTranslateY, setRouteDrawerTranslateY] = useState(null);
	const [routeVisibilityOverride, setRouteVisibilityOverride] =
		useState(null);
	const [isMapLoaded, setIsMapLoaded] = useState(false);

	useEffect(() => {
		handlersRef.current = {
			setActiveStation,
			setSelectedVehicle,
		};
	}, [setActiveStation, setSelectedVehicle]);

	useEffect(() => {
		try {
			const requested = sessionStorage.getItem("openRouteDrawer") === "1";
			if (!requested) return;
			sessionStorage.removeItem("openRouteDrawer");
			setRouteDrawerOpen(true);
			setRouteDrawerSnap("peek");
			} catch {
				// Storage may be unavailable in private browsing.
			}
		}, []);

	const selectedVehicleKey = useMemo(() => {
		if (!selectedVehicle) return null;

		if (selectedVehicle.tripId != null) {
			return String(selectedVehicle.tripId);
		}

		return JSON.stringify({
			lineNumber: selectedVehicle.lineNumber ?? null,
			lineId: selectedVehicle.lineId ?? null,
			routeId: selectedVehicle.routeId ?? null,
			vehicleId: selectedVehicle.vehicleId ?? null,
			from:
				selectedVehicle.from?.stopId ??
				selectedVehicle.from?.name ??
				null,
			to: selectedVehicle.to?.stopId ?? selectedVehicle.to?.name ?? null,
		});
	}, [selectedVehicle]);

	const didMountRef = useRef(false);
	const lastSelectedVehicleKeyRef = useRef(null);
	const [pendingDrawerOpen, setPendingDrawerOpen] = useState(false);

	// When a new vehicle is selected, mark the drawer as pending-open
	useEffect(() => {
		if (!didMountRef.current) {
			didMountRef.current = true;
			lastSelectedVehicleKeyRef.current = selectedVehicleKey;
			return;
		}

		if (!selectedVehicleKey) {
			lastSelectedVehicleKeyRef.current = null;
			setPendingDrawerOpen(false);
			return;
		}

		if (lastSelectedVehicleKeyRef.current !== selectedVehicleKey) {
			lastSelectedVehicleKeyRef.current = selectedVehicleKey;
			setPendingDrawerOpen(true);
		}
	}, [selectedVehicleKey]);

	// Open the drawer once loading is done
	useEffect(() => {
		if (pendingDrawerOpen && !routeLoading) {
			setPendingDrawerOpen(false);
			setRouteDrawerOpen(true);
			setRouteDrawerSnap("peek");
		}
	}, [pendingDrawerOpen, routeLoading]);
	// When the drawer is open for a selected route, show only the route path + route stops overlays.
	// (Arrivals selection bypasses map popups that normally set this up.)
	useEffect(() => {
		if (!routeDrawerOpen || !selectedVehicle) {
			setRouteVisibilityOverride(null);
			return;
		}

		const operatorText =
			typeof selectedVehicle?.operator === "string"
				? selectedVehicle.operator.toLowerCase()
				: "";
		const isTrainRoute =
			selectedVehicle?.brand === "sz" ||
			operatorText.includes("sž") ||
			operatorText.includes("slovenske železnice") ||
			(selectedVehicle?.tripShort != null &&
				selectedVehicle?.lineNumber == null &&
				selectedVehicle?.lineId == null);

		setFilterByRoute(true);
		setRouteVisibilityOverride({
			buses: !isTrainRoute,
			busStops: false,
			trainPositions: isTrainRoute,
			trainStops: false,
		});
	}, [routeDrawerOpen, selectedVehicleKey, selectedVehicle]);

	// Measure drawer height
	useEffect(() => {
		const el = routeDrawerRef.current;
		if (!el) return;

		const update = () => {
			const next = Math.round(el.getBoundingClientRect().height);
			if (Number.isFinite(next) && next > 0) setRouteDrawerHeight(next);
		};

		update();

		if (typeof ResizeObserver === "undefined") return;
		const ro = new ResizeObserver(() => update());
		ro.observe(el);
		return () => ro.disconnect();
	}, []);

	const routeDrawerPeekHeight = 140;
	const routeDrawerPeekTranslateY = useMemo(() => {
		if (!routeDrawerHeight) return 0;
		return Math.max(0, routeDrawerHeight - routeDrawerPeekHeight);
	}, [routeDrawerHeight]);

	// Apply snap when opening/closing or when height changes.
	useEffect(() => {
		if (!routeDrawerOpen) {
			setRouteDrawerTranslateY(null);
			return;
		}

		if (routeDrawerSnap === "full") {
			setRouteDrawerTranslateY(0);
			return;
		}

		setRouteDrawerTranslateY(routeDrawerPeekTranslateY);
	}, [routeDrawerOpen, routeDrawerSnap, routeDrawerPeekTranslateY]);

	const dragStateRef = useRef({
		dragging: false,
		startY: 0,
		startTranslateY: 0,
	});

	const prevRouteDrawerOpenRef = useRef(false);

	const onRouteDrawerPointerDown = (e) => {
		if (!routeDrawerOpen) return;
		if (e.button != null && e.button !== 0) return;

		const startTranslate =
			routeDrawerTranslateY != null
				? routeDrawerTranslateY
				: routeDrawerSnap === "full"
					? 0
					: routeDrawerPeekTranslateY;

		dragStateRef.current = {
			dragging: true,
			startY: e.clientY,
			startTranslateY: startTranslate,
		};

			try {
				e.currentTarget.setPointerCapture(e.pointerId);
			} catch {
				// Pointer capture is not available in every browser.
			}
	};

	const onRouteDrawerPointerMove = (e) => {
		if (!dragStateRef.current.dragging) return;

		const delta = e.clientY - dragStateRef.current.startY;
		const next = dragStateRef.current.startTranslateY + delta;

		const maxY = routeDrawerHeight || routeDrawerPeekTranslateY;
		const clamped = Math.min(maxY, Math.max(0, next));
		setRouteDrawerTranslateY(clamped);
	};

	const onRouteDrawerPointerUpOrCancel = () => {
		if (!dragStateRef.current.dragging) return;
		dragStateRef.current.dragging = false;

		const y =
			routeDrawerTranslateY != null
				? routeDrawerTranslateY
				: routeDrawerPeekTranslateY;

		const dismissThreshold = routeDrawerPeekTranslateY + 60;
		if (y >= dismissThreshold) {
			resetRouteView();
			setRouteDrawerOpen(false);
			return;
		}

		const threshold = routeDrawerPeekTranslateY / 2;
		if (y <= threshold) setRouteDrawerSnap("full");
		else setRouteDrawerSnap("peek");
	};

	const busesGeoJSON = useMemo(() => {
		const filtered = (gpsPositions || []).filter((pos) => {
			const brandKey = operatorToIcon[pos?.operator] || "generic";
			if (!busOperators[brandKey]) return false;

			if (filterByRoute && selectedVehicle) {
				const hasLine =
					pos.lineNumber !== undefined || pos.lineId !== undefined;
				if (hasLine) {
					const match =
						(selectedVehicle.lineNumber &&
							pos.lineNumber === selectedVehicle.lineNumber) ||
						(selectedVehicle.routeName &&
							pos.lineNumber === selectedVehicle.routeName) ||
						(selectedVehicle.tripId &&
							pos.tripId === selectedVehicle.tripId);
					if (!match) return false;
				} else if (
					pos.tripId !== undefined &&
					selectedVehicle.tripId &&
					pos.tripId !== selectedVehicle.tripId
				) {
					return false;
				}
			}
			return true;
		});

		return toGeoJSONPoints(
			filtered,
			(pos) => pos?.gpsLocation,
			(pos) => {
				const icon = operatorToIcon[pos?.operator] || "bus-generic";
				const isLpp =
					pos?.operator
						?.toLowerCase?.()
						.includes("ljubljanski potniški promet") ||
					pos?.lineNumber !== undefined ||
					pos?.lineId !== undefined;
				return {
					...pos,
					gpsLocation: undefined,
					sourceType: isLpp ? "lpp" : "ijpp",
					icon,
					brand: icon === "bus-generic" ? "generic" : icon,
					operator: pos?.operator || "",
				};
			},
		);
	}, [gpsPositions, busOperators, filterByRoute, selectedVehicle]);

	const busStopsGeoJSON = useMemo(
		() =>
			toGeoJSONPoints(
				busStops,
				(stop) => stop?.gpsLocation,
				(stop) => ({
					id:
						stop?.ijppID ??
						stop?.refID ??
						stop?.ref_id ??
						stop?.id ??
						stop?.name,
					name: stop?.name,
					icon: "bus-stop",
					ref_id: stop?.ref_id ?? stop?.refID ?? null,
					gtfs_id: stop?.gtfs_id ?? null,
					ijpp_id: stop?.ijpp_id ?? null,
					vCenter: stop?.vCenter ?? false,
					routes_on_stop: JSON.stringify(stop?.routes_on_stop ?? []),
				}),
			),
		[busStops],
	);

	const trainStopsGeoJSON = useMemo(
		() =>
			toGeoJSONPoints(trainStops, getStopCoord, (stop, coord) => ({
				id: stop?.stopId ?? stop?.id ?? stop?.name,
				name: stop?.name ?? "",
				stopId: stop?.stopId ?? null,
				icon: "train-stop",
				lat: coord?.[0] ?? null,
				lon: coord?.[1] ?? null,
			})),
		[trainStops],
	);

	const trainPositionsGeoJSON = useMemo(() => {
		const filtered =
			filterByRoute && selectedVehicle?.tripId
				? (trainPositions || []).filter(
						(t) => t.tripId === selectedVehicle.tripId,
					)
				: trainPositions || [];

		return toGeoJSONPoints(
			filtered,
			(train) => parseTrainCoord(train?.gpsLocation),
			(train) => ({
				id: train?.tripId,
				relation: [train?.from?.name, train?.to?.name]
					.filter(Boolean)
					.join(" - "),
				fromStation: train?.from?.name,
				toStation: train?.to?.name,
				departure: train?.departure,
				arrival: train?.arrival,
				icon: "train",
				brand: "sz",
				tripId: train?.tripId ?? null,
				tripShort: train?.tripShort ?? null,
				realTime: train?.realtime ?? false,
				from: JSON.stringify(train?.from ?? null),
				to: JSON.stringify(train?.to ?? null),
				bearing: train?.bearing ?? 0,
				delay: train?.delay ?? 0,
			}),
		);
	}, [trainPositions, filterByRoute, selectedVehicle?.tripId]);

	useEffect(() => {
		if (mapInstanceRef.current) return;

		try {
			const map = new maplibregl.Map({
				container: mapRef.current,
				style: getMapStyle(),
				center: [
					initialCenterRef.current[1],
					initialCenterRef.current[0],
				],
				zoom: DEFAULT_ZOOM,
				attributionControl: true,
				maxZoom: 22,
			});

			mapInstanceRef.current = map;
			map.addControl(
				new maplibregl.NavigationControl({ showCompass: true }),
				"top-right",
			);
			map.addControl(
				new maplibregl.GeolocateControl({
					positionOptions: { enableHighAccuracy: true },
					trackUserLocation: true,
					showUserLocation: true,
					showAccuracyCircle: true,
					fitBoundsOptions: { maxZoom: 15 },
				}),
				"top-right",
			);
			map.addControl(
				new maplibregl.FullscreenControl({ container: document.body }),
				"top-right",
			);

			map.on("load", async () => {
				await ensureIcons(map, ICON_SOURCES);

				setupSourcesAndLayers(map, {
					buses: busesGeoJSON,
					busStops: busStopsGeoJSON,
					trainPositions: trainPositionsGeoJSON,
					trainStops: trainStopsGeoJSON,
				});

				// Setup trip overlays for all providers
				["ijpp", "lpp", "sz"].forEach((prefix) =>
					setupTripOverlay(map, prefix, BRAND_COLOR_EXPR),
				);

				// Configure all popups
				configureBusStopPopup({
					map,
					onSelectStop: (stop) => {
						const payload = {
							name: stop.name,
							coordinates: stop.gpsLocation,
							ref_id: stop.ref_id,
							gtfs_id: stop.gtfs_id,
							ijpp_id: stop.ijpp_id,
							type: "bus-stop",
						};
						handlersRef.current.setActiveStation(payload);
						localStorage.setItem(
							"activeStation",
							JSON.stringify(payload),
						);
						window.location.hash = "/lines";
					},
				});

				configureTrainStopPopup({
					map,
					onSelectStop: (stop) => {
						const coordinates = Array.isArray(stop?.gpsLocation)
							? stop.gpsLocation
							: [stop?.lat, stop?.lon];
						if (
							!Array.isArray(coordinates) ||
							!Number.isFinite(coordinates[0]) ||
							!Number.isFinite(coordinates[1])
						) {
							return;
						}
						const payload = {
							name: stop.name,
							coordinates,
							gpsLocation: coordinates,
							stopId: stop.stopId ?? null,
							lat: coordinates[0],
							lon: coordinates[1],
							type: "train-stop",
						};
						handlersRef.current.setActiveStation(payload);
						localStorage.setItem(
							"activeStation",
							JSON.stringify(payload),
						);
						window.location.hash = "/lines";
					},
				});

				configureTrainPopup({
					map,
					onSelectVehicle: (vehicle) => {
						handlersRef.current.setSelectedVehicle(vehicle);
						// Enable route-only SZ view and hide buses & stations
						setFilterByRoute(true);
						setRouteVisibilityOverride({
							buses: false,
							busStops: false,
							trainPositions: true,
							trainStops: false,
						});
					},
				});

				configureBusPopup({
					map,
					onSelectVehicle: (vehicle) => {
						handlersRef.current.setSelectedVehicle(vehicle);
						// Enable route-only bus view and hide stations & SZ markers
						setFilterByRoute(true);
						setRouteVisibilityOverride({
							buses: true,
							busStops: false,
							trainPositions: false,
							trainStops: false,
						});
					},
				});

				// Configure trip stops popups for all providers
				["ijpp", "lpp", "sz"].forEach((prefix) =>
					configureTripStopsPopup(map, `${prefix}-trip-stops-points`),
				);

				setIsMapLoaded(true);
			});

			// Listen for map theme changes
			const handleMapThemeChange = () => {
				map.setStyle(getMapStyle());
			};
			window.addEventListener("mapThemeChange", handleMapThemeChange);

			return () => {
				window.removeEventListener(
					"mapThemeChange",
					handleMapThemeChange,
				);
				map.remove();
				mapInstanceRef.current = null;
			};
		} catch (err) {
			console.error("Failed to initialize map:", err);
			if (mapRef.current) {
				mapRef.current.innerHTML =
					'<div style="display: flex; align-items: center; justify-content: center; height: 100%; background: #f5f5f5;"><div style="text-align: center;"><p style="margin: 0; color: #333; font-size: 16px;">Zemljevid se ne more naložiti</p><p style="margin: 8px 0 0 0; color: #666; font-size: 14px;">Prosim, preverite grafični gonilnik ali poskusite osvežiti stran.</p></div></div>';
			}
		}
		// Map initialization intentionally runs once; data updates use dedicated effects below.
		// eslint-disable-next-line react-hooks/exhaustive-deps
		}, []);

		// Update GeoJSON sources
	useEffect(() => {
		const map = mapInstanceRef.current;
		if (!map) return;
		updateSourceData(map, "buses", busesGeoJSON);
		updateSourceData(map, "busStops", busStopsGeoJSON);
		updateSourceData(map, "trainPositions", trainPositionsGeoJSON);
		updateSourceData(map, "trainStops", trainStopsGeoJSON);
	}, [
		busesGeoJSON,
		busStopsGeoJSON,
		trainPositionsGeoJSON,
		trainStopsGeoJSON,
	]);

	// Apply layer visibility (use override when route is selected)
	useEffect(() => {
		const map = mapInstanceRef.current;
		if (!map) return;
		const effectiveVisibility = routeVisibilityOverride || visibility;
		setPrefixVisible(map, "buses", effectiveVisibility.buses);
		setPrefixVisible(map, "busStops", effectiveVisibility.busStops);
		setPrefixVisible(map, "trainStops", effectiveVisibility.trainStops);
		setPrefixVisible(
			map,
			"trainPositions",
			effectiveVisibility.trainPositions,
		);
	}, [visibility, routeVisibilityOverride, isMapLoaded]);

	// Update all trip overlays in a single effect
	useEffect(() => {
		const map = mapInstanceRef.current;
		if (!map || !isMapLoaded) return;

		// Clear all overlays first
		["ijpp", "lpp", "sz"].forEach((p) => clearTripOverlay(map, p));
		if (!selectedVehicle) return;

		const brand = operatorToIcon[selectedVehicle?.operator] || "generic";
		const geo = selectedVehicle.geometry || [];
		const validCoord = (c) => Array.isArray(c) && c.length >= 2;

		// Determine provider and collect coords/stops for overlay + fitBounds
		const hasLppPoints = geo[0]?.points !== undefined;
		const isLpp = selectedVehicle.lineId !== undefined || hasLppPoints;
		const isSz =
			selectedVehicle.tripShort !== undefined &&
			selectedVehicle.lineNumber === undefined;

		let prefix, lineCoords, stopsFeatures, overlayBrand;

		if (isLpp) {
			prefix = "lpp";
			lineCoords = hasLppPoints
				? geo[0].points.filter(validCoord).map((c) => [c[1], c[0]])
				: [];
			stopsFeatures = stopsToFeatures(selectedVehicle.stops, "lpp");
			overlayBrand = "lpp";
		} else if (isSz) {
			prefix = "sz";
			lineCoords = geo.filter(validCoord);
			stopsFeatures = stopsToFeatures(
				selectedVehicle.stops,
				"sz",
				selectedVehicle.from,
				selectedVehicle.to,
			);
			overlayBrand = "sz";
		} else if (selectedVehicle.tripId !== undefined) {
			prefix = "ijpp";
			lineCoords = geo.filter(validCoord);
			stopsFeatures = stopsToFeatures(selectedVehicle.stops, brand);
			overlayBrand = brand;
		} else {
			return;
		}

		updateTripOverlay(map, prefix, lineCoords, stopsFeatures, overlayBrand);

		// Fit the map viewport to the route path + stops
		const isMulti =
			lineCoords.length > 0 &&
			Array.isArray(lineCoords[0]) &&
			Array.isArray(lineCoords[0][0]);

		const allCoords = [];
		if (isMulti) {
			lineCoords.forEach((seg) => seg.forEach((c) => allCoords.push(c)));
		} else {
			lineCoords.forEach((c) => allCoords.push(c));
		}
		stopsFeatures.forEach((f) => {
			if (f?.geometry?.coordinates)
				allCoords.push(f.geometry.coordinates);
		});

		if (allCoords.length > 0) {
			const bounds = new maplibregl.LngLatBounds();
			allCoords.forEach((c) => {
				if (
					Array.isArray(c) &&
					c.length >= 2 &&
					Number.isFinite(c[0]) &&
					Number.isFinite(c[1]) &&
					(Math.abs(c[0]) > 0.001 || Math.abs(c[1]) > 0.001)
				) {
					bounds.extend([c[0], c[1]]);
				}
			});
			if (!bounds.isEmpty()) {
				map.fitBounds(bounds, {
					padding: {
						top: 60,
						right: 60,
						bottom: routeDrawerPeekHeight + 60,
						left: 60,
					},
					maxZoom: 15,
					duration: 800,
				});
			}
		}
	}, [selectedVehicle, isMapLoaded]);

	// Update markers
	useEffect(() => {
		const map = mapInstanceRef.current;
		if (!map) return;

		refreshMarker({
			map,
			markersRef,
			key: "user",
			coords: userLocation,
			img: userPNG,
			size: [22, 22],
			popup: "Vaša lokacija",
		});

		refreshMarker({
			map,
			markersRef,
			key: "active",
			coords: activeStation?.coordinates,
			img: locationPNG,
			size: [22, 22],
			popup: "Aktivna postaja",
		});
	}, [userLocation, activeStation]);

	//zbriše črto in postaje na poti iz zemljevida
	const clearPathOverlays = useCallback(() => {
		const map = mapInstanceRef.current;
		if (map) {
			["ijpp", "lpp", "sz"].forEach((prefix) =>
				clearTripOverlay(map, prefix),
			);
		}
	}, []);

	const resetRouteView = useCallback(() => {
		setFilterByRoute(false);
		setRouteVisibilityOverride(null);
		clearPathOverlays();
		setSelectedVehicle(null);
	}, [clearPathOverlays, setSelectedVehicle]);

	useEffect(() => {
		const wasOpen = prevRouteDrawerOpenRef.current;
		prevRouteDrawerOpenRef.current = routeDrawerOpen;
		if (wasOpen && !routeDrawerOpen) {
			resetRouteView();
		}
	}, [routeDrawerOpen, resetRouteView]);

	return (
		<div>
			<div className="map-container" style={{ position: "relative" }}>
				<div ref={mapRef} style={{ height: "100%", width: "100%" }} />
				{routeLoading && (
					<div className="map-route-loading">
						<span className="map-route-loading_spinner" />
						Nalaganje poti...
					</div>
				)}
				<div
					className={
						routeDrawerOpen
							? "route-drawer route-drawer--open"
							: "route-drawer"
					}
					ref={routeDrawerRef}
					style={
						routeDrawerOpen
							? {
									transform: `translateY(${
										routeDrawerTranslateY ??
										routeDrawerPeekTranslateY
									}px)`,
								}
							: undefined
					}
					role="dialog"
					aria-label="Pot">
					<div
						className="route-drawer__header"
						onPointerDown={onRouteDrawerPointerDown}
						onPointerMove={onRouteDrawerPointerMove}
						onPointerUp={onRouteDrawerPointerUpOrCancel}
						onPointerCancel={onRouteDrawerPointerUpOrCancel}>
						<div
							className="route-drawer__grab"
							aria-hidden="true"
						/>
						<button
							type="button"
							className="route-drawer__close"
							aria-label="Zapri"
							onPointerDown={(e) => {
								e.stopPropagation();
							}}
							onClick={(e) => {
								e.stopPropagation();
								resetRouteView();
								setRouteDrawerOpen(false);
							}}>
							×
						</button>
					</div>
					<div className="route-drawer__content">
						{selectedVehicle ? (
							<RouteTab
								selectedVehicle={selectedVehicle}
								gpsPositions={gpsPositions}
								setActiveStation={setActiveStation}
								onDragPointerDown={onRouteDrawerPointerDown}
								onDragPointerMove={onRouteDrawerPointerMove}
								onDragPointerUpOrCancel={
									onRouteDrawerPointerUpOrCancel
								}
							/>
						) : (
							<div style={{ padding: 12 }}>
								<p>Ni izbrane linije.</p>
							</div>
						)}
					</div>
				</div>
			</div>
		</div>
	);
});

export default Map;
