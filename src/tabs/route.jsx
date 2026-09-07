import { useMemo } from "react";
import { formatTime } from "../Api.jsx";

// Razdalja med dvema GPS točkama v metrih (haversine)
const distanceMeters = (a, b) => {
	if (!a || !b) return Infinity;
	const [lat1, lon1] = a;
	const [lat2, lon2] = b;
	if (
		!Number.isFinite(lat1) ||
		!Number.isFinite(lon1) ||
		!Number.isFinite(lat2) ||
		!Number.isFinite(lon2)
	)
		return Infinity;

	const R = 6371000;
	const toRad = (d) => (d * Math.PI) / 180;
	const dLat = toRad(lat2 - lat1);
	const dLon = toRad(lon2 - lon1);
	const sinLat = Math.sin(dLat / 2);
	const sinLon = Math.sin(dLon / 2);
	const h =
		sinLat * sinLat +
		Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * sinLon * sinLon;
	return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
};

// Bus se šteje za "na tej postaji", če je bližje kot toliko metrov.
// LPP postaje so gosto posejane (mestni promet), IJPP (medkrajevni) pa
// so razmaknjene dlje narazen, zato dovolimo večji radij.
const SNAP_DISTANCE_LPP_M = 700;
const SNAP_DISTANCE_OTHER_M = 1500;

const normalizeStr = (value) =>
	typeof value === "string" ? value.trim().toLowerCase() : value;

const RouteTab = ({
	selectedVehicle,
	gpsPositions,
	setActiveStation,
	onDragPointerDown,
	onDragPointerMove,
	onDragPointerUpOrCancel,
}) => {
	const isLPP = selectedVehicle?.isLPP;
	const isSZ = selectedVehicle?.isSZ;

	const stops = selectedVehicle?.stops || [];

	// Najde vse busse, ki trenutno vozijo isto linijo (v isto smer), in jih
	// pripne na najbližjo postajo na tej poti (za prikaz na dot-route timeline)
	const busesByStopIndex = useMemo(() => {
		const result = {};
		if (!gpsPositions?.length || !stops.length) return result;

		let candidates = [];
		if (isLPP) {
			// lineId je specifičen za posamezno smer/varianto linije, zato
			// z njim izločimo buse, ki vozijo v nasprotno smer. Če lineId
			// ni na voljo, se kot fallback uporabi širši lineNumber.
			const selfLineId = selectedVehicle?.lineId;
			const selfLineNumber = selectedVehicle?.lineNumber;
			if (selfLineId != null) {
				candidates = gpsPositions.filter(
					(pos) =>
						pos.lineId != null &&
						String(pos.lineId) === String(selfLineId),
				);
			} else if (selfLineNumber != null) {
				candidates = gpsPositions.filter(
					(pos) =>
						pos.lineNumber != null &&
						String(pos.lineNumber) === String(selfLineNumber),
				);
			}
		} else if (!isSZ && selectedVehicle?.tripName) {
			// IJPP nima ID-ja linije, zato buse na isti liniji (v isto smer)
			// prepoznamo po istem "headsign" imenu potovanja
			const selfHeadsign = normalizeStr(selectedVehicle.tripName);
			candidates = gpsPositions.filter(
				(pos) =>
					pos.vehicleId != null &&
					normalizeStr(pos.lineName) === selfHeadsign,
			);
		}

		const snapDistance = isLPP
			? SNAP_DISTANCE_LPP_M
			: SNAP_DISTANCE_OTHER_M;

		candidates.forEach((bus, idx) => {
			let bestIndex = -1;
			let bestDist = Infinity;
			stops.forEach((stop, stopIndex) => {
				const d = distanceMeters(bus.gpsLocation, stop.gpsLocation);
				if (d < bestDist) {
					bestDist = d;
					bestIndex = stopIndex;
				}
			});
			if (bestIndex === -1 || bestDist > snapDistance) return;

			if (!result[bestIndex]) result[bestIndex] = [];
			result[bestIndex].push({
				key: bus.tripId || bus.vehicleId || bus.busName || idx,
				isSelf:
					!!selectedVehicle?.tripId &&
					bus.tripId === selectedVehicle.tripId,
				label:
					bus.busName || bus.lineDestination || bus.lineName || "Bus",
			});
		});

		return result;
	}, [gpsPositions, stops, isLPP, isSZ, selectedVehicle]);

	// Postaja, kjer se trenutno nahaja IZBRANI bus (iz gpsPositions),
	// če je na voljo živa lokacija zanj
	const selfStopIndex = useMemo(() => {
		for (const idx of Object.keys(busesByStopIndex)) {
			if (busesByStopIndex[idx].some((bus) => bus.isSelf))
				return Number(idx);
		}
		return null;
	}, [busesByStopIndex]);

	// Ali imamo za to potovanje sploh podatek "passed" (samo IJPP)
	const hasPassedData = useMemo(
		() => stops.some((stop) => stop.passed !== undefined),
		[stops],
	);

	// Za SZ vlake ni podatka "passed", zato ugotovimo trenutno postajo
	// glede na to, katera postaja je prva, za katero čas še ni potekel
	// (ETA bi bila 0 min, ker je vlak tam že bil/je tam)
	const szCurrentIndex = useMemo(() => {
		if (!isSZ) return null;
		const now = Date.now();
		for (let i = 0; i < stops.length; i++) {
			const timeVal = stops[i]?.departure || stops[i]?.arrival;
			if (!timeVal) continue;
			const date = new Date(timeVal);
			if (isNaN(date)) continue;
			if (date.getTime() > now) return i;
		}
		return null;
	}, [isSZ, stops]);

	// Formats arrival for LPP { eta_min } objects or IJPP "HH:MM:SS" strings
	const formatArrivalTime = (arrival) => {
		if (!arrival) return "";
		let etaMin, date;

		if (typeof arrival === "object" && arrival.eta_min !== undefined) {
			etaMin = arrival.eta_min;
			date = new Date(Date.now() + etaMin * 60000);
		} else if (
			typeof arrival === "string" &&
			arrival.match(/^\d{2}:\d{2}(:\d{2})?$/)
		) {
			const today = new Date().toISOString().split("T")[0];
			date = new Date(`${today}T${arrival}`);
			if (!isNaN(date))
				etaMin = Math.max(0, Math.round((date - Date.now()) / 60000));
		}

		if (etaMin === undefined) return "";
		const timeStr = date && !isNaN(date) ? formatTime(date) : "N/A";
		return etaMin >= 60
			? `${Math.floor(etaMin / 60)}h ${etaMin % 60}m \n(${timeStr})`
			: `${etaMin} min\n(${timeStr})`;
	};

	const formatSZETA = (time) => {
		if (!time) return "";
		const date = new Date(time);
		if (isNaN(date)) return "";
		const etaMin = Math.max(0, Math.round((date - Date.now()) / 60000));
		const timeStr = formatTime(date);
		return etaMin >= 60
			? `${Math.floor(etaMin / 60)}h ${etaMin % 60}m \n(${timeStr})`
			: `${etaMin} min \n(${timeStr})`;
	};

	const lineName =
		(isLPP ? selectedVehicle?.lineNumber + " | " : "") +
		selectedVehicle?.tripName;
	const operator = isLPP
		? "Ljubljanski potniški promet"
		: isSZ
			? "Slovenske železnice"
			: selectedVehicle?.operator == "MP_Kranj"
				? "Mestni promet Kranj"
				: selectedVehicle?.operator;

	return (
		<div className="route">
			<div
				className="data"
				onPointerDown={onDragPointerDown}
				onPointerMove={onDragPointerMove}
				onPointerUp={onDragPointerUpOrCancel}
				onPointerCancel={onDragPointerUpOrCancel}>
				<h3>{lineName || "Neznana linija"}</h3>
				<p>{operator}</p>
			</div>
			<div className="stops">
				<ul>
					{stops.length > 0 ? (
						stops.map((stop, key) => {
							const isFirst = key === 0;
							const isLast = key === stops.length - 1;
							const isPassed =
								stop.passed === true ||
								(isSZ &&
									szCurrentIndex !== null &&
									key < szCurrentIndex);
							const isCurrent =
								selfStopIndex !== null
									? key === selfStopIndex
									: isSZ
										? key === szCurrentIndex
										: hasPassedData
											? !isPassed &&
												(isFirst ||
													stops[key - 1]?.passed ===
														true)
											: false;
							const busesHere = (
								busesByStopIndex[key] || []
							).filter((bus) => !bus.isSelf);

							return (
								<li
									key={stop.gtfsId || stop.stopId || key}
									className={
										"stop" +
										(isFirst ? " stop--first" : "") +
										(isLast ? " stop--last" : "") +
										(isPassed ? " stop--passed" : "") +
										(isCurrent ? " stop--current" : "")
									}
									onClick={() => {
										const payload = {
											name: stop.name,
											coordinates: stop.gpsLocation,
											id:
												stop.gtfsId ||
												stop.stopId ||
												stop.name,
											gtfs_id: stop.gtfsId,
											gtfsId: stop.gtfsId,
											stopId: stop.stopId,
											station_code: stop.stopId,
											type: isSZ
												? "train-stop"
												: "bus-stop",
										};
										setActiveStation(payload);
										localStorage.setItem(
											"activeStation",
											JSON.stringify(payload),
										);
										window.location.hash = "/lines";
									}}>
									<span
										className="stop__track"
										aria-hidden="true">
										<span className="stop__dot" />
										{busesHere.length > 0 && (
											<span className="stop__buses">
												{busesHere.map((bus) => (
													<span
														key={bus.key}
														className="stop__bus"
														title={bus.label}
													/>
												))}
											</span>
										)}
									</span>
									<h3>{stop.name}</h3>
									{!isLPP && !isSZ && (
										<p
                                            style={{ marginRight: "10px" }}
                                        >
											{formatArrivalTime(stop?.departure)}
										</p>
									)}
									{isLPP && (
										<span
											style={{
												display: "flex",
												flexDirection: "row",
												gap: "20px",
												whiteSpace: "pre-line",
												textAlign: "center",
                                                marginRight: "10px",
											}}>
											{stop.arrivals?.[0] && (
												<p>
													{formatArrivalTime(
														stop.arrivals[0],
													)}
												</p>
											)}
											{stop.arrivals?.[1] && (
												<p>
													{formatArrivalTime(
														stop.arrivals[1],
													)}
												</p>
											)}
										</span>
									)}
									{isSZ && (
										<span
											style={{
												display: "flex",
												gap: "20px",
                                                textAlign: "center",
                                                whiteSpace: "pre-line",
                                                marginRight: "10px",
											}}>
											{stop.departure ? (
												<p>
													{formatSZETA(
														stop.departure,
													)}
												</p>
											) : (
												<p>
													{formatSZETA(stop.arrival)}
												</p>
											)}
										</span>
									)}
								</li>
							);
						})
					) : (
						<p>Ni podatkov o postajah.</p>
					)}
				</ul>
			</div>
		</div>
	);
};

export default RouteTab;
