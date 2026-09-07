import { useState, useEffect, useMemo, useCallback, memo } from "react";
import { Heart } from "lucide-react";
import { formatPrecomputedArrival } from "../Api";

const LIKED_ROUTES_KEY = "likedRoutes";
const LIKED_STATIONS_KEY = "likedStations";
const lppRoutesApiUrl = "https://tracker.cernetic.cc/api/lpp-all-routes";

const loadLikedItems = (key) => {
	try {
		const stored = localStorage.getItem(key);
		return stored ? JSON.parse(stored) : [];
	} catch {
		return [];
	}
};

const saveLikedItems = (key, items) => {
	try {
		localStorage.setItem(key, JSON.stringify(items));
	} catch {}
};

const bgColorMap = (item) => {
	const operator = item?.operator || item?.operatorName;
	const type = item?.type;

	if (
		type === "LPP" ||
		operator?.toLowerCase().includes("ljubljanski potniški promet")
	)
		return "var(--lpp-color)";
	if (
		type === "SZ" ||
		operator?.includes("slovenske železnice") ||
		operator?.includes("SŽ")
	)
		return "var(--sz-color)";
	if (operator?.includes("Nomago")) return "var(--nomago-color)";
	if (operator?.includes("Marprom")) return "var(--marprom-color)";
	if (operator?.includes("Arriva")) return "var(--arriva-color)";
	if (operator?.includes("Murska")) return "var(--murska-color)";
	if (operator?.includes("Kranj")) return "var(--kranj-color)";

	return "var(--default-color)";
};

const formatDelay = (scheduledDeparture, actualDeparture) => {
	if (!scheduledDeparture || !actualDeparture) return "N/A";
	const scheduled = new Date(scheduledDeparture);
	const actual = new Date(actualDeparture);
	if (isNaN(scheduled) || isNaN(actual)) return "N/A";
	const diffMinutes = Math.round((actual - scheduled) / 60000);
	if (diffMinutes === 0) return " 0 min";
	return diffMinutes > 0 ? ` ${diffMinutes} min` : ` -${diffMinutes} min`;
};

const getEndpointName = (endpoint) => {
	if (!endpoint) return "";
	if (typeof endpoint === "string") return endpoint;
	if (typeof endpoint === "object") {
		return (
			endpoint.name ||
			endpoint.stopName ||
			endpoint.stationName ||
			endpoint.title ||
			""
		);
	}
	return "";
};

const getRouteDisplayName = (item) => {
	return (
		item.displayName ||
		item.lineName ||
		item.headsign ||
		item.name ||
		item.tripName ||
		[getEndpointName(item.from), getEndpointName(item.to)]
			.filter(Boolean)
			.join(" - ")
	);
};

const RouteItem = memo(({ item, isLiked, onToggleLike, onClick }) => (
	<div className="route-item" onClick={onClick}>
		<div className="circle" style={{ background: bgColorMap(item) }}>
			{item.lineNumber ??
				item.routeName ??
				item.routeShortName ??
				item.tripShort ??
				item.tripId?.slice(5) ??
				"?"}
		</div>
		<h3>{getRouteDisplayName(item)}</h3>
		<button
			className={`like-btn ${isLiked ? "liked" : ""}`}
			onClick={onToggleLike}
			aria-label={
				isLiked ? "Odstrani iz priljubljenih" : "Dodaj med priljubljene"
			}>
			<Heart size={20} fill={isLiked ? "currentColor" : "none"} />
		</button>
	</div>
));

const ArrivalItem = memo(({ arrival, onRouteClick }) => (
	<div
		className="arrival-item"
		onClick={() => onRouteClick(arrival, arrival.type)}>
		<div className="left">
			<div className="circle" style={{ background: bgColorMap(arrival) }}>
				<h2
					className={
						arrival.type === "SZ"
							? "sz"
							: arrival.type === "LPP"
								? "lpp"
								: ""
					}>
					{arrival.type === "LPP"
						? arrival.routeName
						: arrival.routeShortName || arrival.tripName}
				</h2>
			</div>
			<div className="info">
				<h3>{arrival.tripName || arrival.headsign}</h3>
				<h4>{arrival.operatorName}</h4>
			</div>
		</div>
		<p
			style={{
				whiteSpace: "pre-line",
				textAlign: "center",
				fontSize: "14px",
			}}>
			{formatPrecomputedArrival(arrival)}
		</p>
		{arrival.type === "SZ" && arrival.realTime && (
			<p>
				{"Zamuda: " +
					formatDelay(
						arrival.scheduledDeparture,
						arrival.realtimeDeparture,
					)}
			</p>
		)}
	</div>
));

const SkeletonArrivalItem = memo(() => (
	<div className="arrival-item skeleton">
		<div className="left">
			<div className="circle skeleton-circle"></div>
			<div className="skeleton-text skeleton-title"></div>
		</div>
		<div className="skeleton-text skeleton-time"></div>
	</div>
));

const LinesTab = ({
	gpsPositions,
	activeStation,
	ijppArrivals,
	lppArrivals,
	szArrivals,
	getTripFromId,
	arrivalsLoading,
	trainPositions,
}) => {
	const [searchTerm, setSearchTerm] = useState("");
	const [debouncedSearchTerm, setDebouncedSearchTerm] = useState("");
	const [page, setPage] = useState("arrivals"); // all, arrivals, liked
	const [likedRoutes, setLikedRoutes] = useState(() =>
		loadLikedItems(LIKED_ROUTES_KEY),
	);
	const [likedStations, setLikedStations] = useState(() =>
		loadLikedItems(LIKED_STATIONS_KEY),
	);
	const [lppNumberedRoutes, setLppNumberedRoutes] = useState([]);

	// Debounce search term for better performance
	useEffect(() => {
		const timer = setTimeout(() => {
			setDebouncedSearchTerm(searchTerm);
		}, 300);
		return () => clearTimeout(timer);
	}, [searchTerm]);

	// Fetch LPP routes
	useEffect(() => {
		const fetchLppRoutes = async () => {
			try {
				const response = await fetch(lppRoutesApiUrl);
				if (!response.ok)
					throw new Error("Network response was not ok");
				const data = await response.json();
				setLppNumberedRoutes(data?.data || []);
			} catch {
				setLppNumberedRoutes([]);
			}
		};
		fetchLppRoutes();
	}, []);

	// Get unique station ID for liking
	const getStationId = useCallback((station) => {
		return station?.ref_id || station?.id || station?.name;
	}, []);

	const isCurrentStationLiked = useCallback(() => {
		if (!activeStation) return false;
		const id = getStationId(activeStation);
		return likedStations.some((s) => s.id === id);
	}, [activeStation, likedStations, getStationId]);

	const toggleLikeStation = useCallback(
		(e) => {
			e?.stopPropagation();
			const id = getStationId(activeStation);
			setLikedStations((prev) => {
				const exists = prev.some((s) => s.id === id);
				const newLiked = exists
					? prev.filter((s) => s.id !== id)
					: [
							...prev,
							{
								id,
								name: activeStation.name,
								data: activeStation,
							},
						];
				saveLikedItems(LIKED_STATIONS_KEY, newLiked);
				return newLiked;
			});
		},
		[activeStation, getStationId],
	);

	// All active routes from GPS positions
	const allActiveRoutes = useMemo(() => {
		const shouldInclude = (pos) =>
			!(
				pos?.operator === "Ljubljanski potniški promet d.o.o." &&
				!pos?.lineName
			);

		const uniqueRoutes = [];
		const seenNames = new Set();

		for (const vehicle of gpsPositions.filter(shouldInclude)) {
			const name = vehicle.lineName || vehicle.route_name;
			if (name && !seenNames.has(name)) {
				seenNames.add(name);
				uniqueRoutes.push(vehicle);
			}
		}

		for (const train of trainPositions) {
			const name = train.tripShort;
			if (name && !seenNames.has(name)) {
				seenNames.add(name);
				uniqueRoutes.push({
					...train,
					lineName: name,
					lineNumber: name,
					tripName: [
						getEndpointName(train.from),
						getEndpointName(train.to),
					]
						.filter(Boolean)
						.join(" - "),
					displayName: [
						getEndpointName(train.from),
						getEndpointName(train.to),
					]
						.filter(Boolean)
						.join(" - "),
					operator: "Slovenske železnice d.o.o.",
					type: "SZ",
				});
			}
		}
		return uniqueRoutes;
	}, [gpsPositions, trainPositions]);

	// Get unique route ID for liking
	const getRouteId = useCallback((route) => {
		return (
			route?.lineName ||
			route?.route_name ||
			route?.lineNumber ||
			route?.routeName ||
			route?.tripShort ||
			route?.tripId
		);
	}, []);

	const isRouteLiked = useCallback(
		(route) => {
			const id = getRouteId(route);
			return likedRoutes.some((r) => r.id === id);
		},
		[likedRoutes, getRouteId],
	);

	const toggleLikeRoute = useCallback(
		(route, e) => {
			e?.stopPropagation();
			const id = getRouteId(route);
			setLikedRoutes((prev) => {
				const exists = prev.some((r) => r.id === id);
				const newLiked = exists
					? prev.filter((r) => r.id !== id)
					: [
							...prev,
							{
								id,
								name:
									route.displayName ||
									route.lineName ||
									route.route_name ||
									route.tripName ||
									route.tripShort,
								lineNumber:
									route.lineNumber ||
									route.routeName ||
									route.tripShort,
								operator: route.operator || route.operatorName,
								headsign:
									route.headsign ||
									route.displayName ||
									route.tripName ||
									[
										getEndpointName(route.from),
										getEndpointName(route.to),
									]
										.filter(Boolean)
										.join(" - "),
								displayName:
									route.displayName ||
									route.tripName ||
									[
										getEndpointName(route.from),
										getEndpointName(route.to),
									]
										.filter(Boolean)
										.join(" - "),
								tripId: route.tripId,
								tripShort: route.tripShort,
								lineId: route.lineId,
								routeId: route.routeId,
							},
						];
				saveLikedItems(LIKED_ROUTES_KEY, newLiked);
				return newLiked;
			});
		},
		[getRouteId],
	);

	// Combined arrivals for current station
	const allArrivals = useMemo(() => {
		const ijppFiltered = (ijppArrivals || [])
			.filter((arrival) =>
				arrival?.tripName
					?.toLowerCase()
					.includes(debouncedSearchTerm.toLowerCase()),
			)
			.filter(
				(arrival) =>
					!arrival?.operatorName
						?.toLowerCase()
						.includes("ljubljanski potniški promet") ||
					arrival?.etaMinutes > 60,
			)
			.map((arrival) => ({ ...arrival, type: "IJPP" }));

		const lppFiltered = (lppArrivals || [])
			.filter(
				(arrival) =>
					arrival.tripName
						?.toLowerCase()
						.includes(debouncedSearchTerm.toLowerCase()) ||
					arrival.routeName
						?.toLowerCase()
						.includes(debouncedSearchTerm.toLowerCase()),
			)
			.map((arrival) => ({ ...arrival, type: "LPP" }));

		const szFiltered = (szArrivals || [])
			.filter((arrival) =>
				arrival.headsign
					?.toLowerCase()
					.includes(debouncedSearchTerm.toLowerCase()),
			)
			.map((arrival) => ({ ...arrival, type: "SZ" }));

		return [...ijppFiltered, ...lppFiltered, ...szFiltered].sort(
			(a, b) => (a.etaMinutes ?? Infinity) - (b.etaMinutes ?? Infinity),
		);
	}, [ijppArrivals, lppArrivals, szArrivals, debouncedSearchTerm]);

	// Filtered routes for "All" - combines LPP numbered routes and active routes
	const filteredAllRoutes = useMemo(() => {
		if (debouncedSearchTerm.length < 1) return [];

		const term = debouncedSearchTerm.toLowerCase();

		// Search in LPP numbered routes (works with short queries)
		const filteredLpp = lppNumberedRoutes
			.filter(
				(route) =>
					route?.route_number
						?.toString()
						.toLowerCase()
						.includes(term) ||
					route?.route_name?.toLowerCase().includes(term),
			)
			.map((route) => ({
				lineName: route.route_name,
				lineNumber: route.route_number,
				tripId: route.trip_id,
				routeId: route.route_id,
				lineId: route.route_id,
				operator: "Ljubljanski potniški promet d.o.o.",
			}));

		// For longer searches, also include active routes
		if (debouncedSearchTerm.length >= 3) {
			const filteredActive = allActiveRoutes.filter((route) =>
				(
					route.lineName ||
					route.route_name ||
					route.lineNumber ||
					route.routeName ||
					route.tripShort ||
					route.tripId ||
					""
				)
					.toString()
					.toLowerCase()
					.includes(term),
			);

			// Combine and deduplicate
			const combined = [...filteredLpp];
			const seenIds = new Set(combined.map((r) => getRouteId(r)));

			for (const route of filteredActive) {
				const id = getRouteId(route);
				if (!seenIds.has(id)) {
					seenIds.add(id);
					combined.push(route);
				}
			}

			return combined;
		}

		return filteredLpp;
	}, [debouncedSearchTerm, lppNumberedRoutes, allActiveRoutes, getRouteId]);

	// Filtered liked routes
	const filteredLikedRoutes = useMemo(() => {
		return likedRoutes.filter((liked) =>
			(liked.name || liked.lineNumber || "")
				.toLowerCase()
				.includes(debouncedSearchTerm.toLowerCase()),
		);
	}, [likedRoutes, debouncedSearchTerm]);

	const handleRouteClick = useCallback(
		async (item, type) => {
			// Don't try to fetch if there's no valid ID
			if (!item.tripId && !item.lineId && !item.routeId) {
				console.warn("No valid trip/line ID for route", item);
				return;
			}

			const operatorType =
				type ||
				(item.type === "SZ" ||
				item.tripShort ||
				item.operator?.toLowerCase().includes("slovenske železnice")
					? "SZ"
					: item.operator
								?.toLowerCase()
								.includes("ljubljanski potniški promet")
						? "LPP"
						: "IJPP");
			const route = await getTripFromId(item, operatorType);
			if (route) {
				try {
					sessionStorage.setItem("openRouteDrawer", "1");
				} catch {}
				window.location.hash = "/map";
			}
		},
		[getTripFromId],
	);

	return (
		<div className="insideDiv">
			<div className="lines-header">
				<h2>Linije {"(" + activeStation?.name + ")"}</h2>
				<button
					className={`like-btn ${isCurrentStationLiked() ? "liked" : ""}`}
					onClick={toggleLikeStation}
					aria-label={
						isCurrentStationLiked()
							? "Odstrani iz priljubljenih"
							: "Dodaj med priljubljene"
					}>
					<Heart
						size={20}
						fill={isCurrentStationLiked() ? "currentColor" : "none"}
					/>
				</button>
			</div>
			<input
				type="text"
				placeholder={
					page === "arrivals"
						? "Išči po številki linije..."
						: "Išči linije..."
				}
				className="search-input"
				value={searchTerm}
				onChange={(e) => setSearchTerm(e.target.value)}
			/>
			<div className="top-nav">
				<button
					className={page === "arrivals" ? "active" : ""}
					onClick={() => setPage("arrivals")}>
					Prihodi
				</button>
				<button
					className={page === "all" ? "active" : ""}
					onClick={() => setPage("all")}>
					Vse
				</button>
				<button
					className={page === "liked" ? "active" : ""}
					onClick={() => setPage("liked")}>
					Priljubljene
				</button>
			</div>
			<div className="results">
				{page === "arrivals" && (
					<div className="arrival-list">
						{arrivalsLoading && (
							<>
								<SkeletonArrivalItem />
								<SkeletonArrivalItem />
								<SkeletonArrivalItem />
								<SkeletonArrivalItem />
								<SkeletonArrivalItem />
							</>
						)}
						{!arrivalsLoading && allArrivals.length === 0 && (
							<p className="empty-message">
								Ni prihodov na tej postaji.
							</p>
						)}
						{!arrivalsLoading &&
							allArrivals.map((arrival, index) => (
								<ArrivalItem
									key={`arrival-${index}`}
									arrival={arrival}
									onRouteClick={handleRouteClick}
								/>
							))}
					</div>
				)}
				{page === "all" && (
					<>
						{searchTerm.length < 1 && (
							<p className="empty-message">
								Vnesite številko linije ali ime.
							</p>
						)}
						{searchTerm.length >= 1 &&
							filteredAllRoutes.length === 0 && (
								<p className="empty-message">Ni rezultatov.</p>
							)}
						<ul className="route-list">
							{filteredAllRoutes.map((route, index) => (
								<RouteItem
									key={`route-${index}`}
									item={route}
									isLiked={isRouteLiked(route)}
									onToggleLike={(e) =>
										toggleLikeRoute(route, e)
									}
									onClick={() => handleRouteClick(route)}
								/>
							))}
						</ul>
					</>
				)}
				{page === "liked" && (
					<>
						{filteredLikedRoutes.length === 0 && (
							<p className="empty-message">
								Ni priljubljenih linij. Kliknite na ❤️ za
								dodajanje.
							</p>
						)}
						<ul className="route-list">
							{filteredLikedRoutes.map((liked, index) => {
								const activeRoute = allActiveRoutes.find(
									(r) => getRouteId(r) === liked.id,
								);
								const routeData = activeRoute || {
									lineName: liked.name,
									lineNumber: liked.lineNumber,
									operator: liked.operator,
									headsign: liked.headsign,
									displayName:
										liked.displayName || liked.name,
									tripId: liked.tripId,
									tripShort: liked.tripShort,
									lineId: liked.lineId,
									routeId: liked.routeId,
								};
								return (
									<RouteItem
										key={`liked-${index}`}
										item={routeData}
										isLiked={true}
										onToggleLike={(e) =>
											toggleLikeRoute(routeData, e)
										}
										onClick={() =>
											handleRouteClick(routeData)
										}
									/>
								);
							})}
						</ul>
					</>
				)}
			</div>
		</div>
	);
};

export default LinesTab;
