import { useState, useMemo, useCallback, memo, useEffect, useRef } from "react";
import { Bus, Train, Heart } from "lucide-react";
import { VariableSizeList as List } from "react-window";

const LIKED_STATIONS_KEY = "likedStations";
const STATION_SEARCH_KEY = "stationSearchTerm";

const StationItem = memo(
	({ station, onSelect, isLiked, onToggleLike, showDistance }) => (
		<div className="station-item-search" onClick={onSelect}>
			<div className="station-content">
				<div className="name">
					{station?.type === "sz" ? (
						<Train size={24} />
					) : (
						<Bus size={24} />
					)}
					<h3>{station?.name}</h3>
					{station?.vCenter !== null && station?.type !== "sz" && (
						<span
							style={{
								fontSize: "11px",
								backgroundColor:
									station?.vCenter === true
										? "darkgreen"
										: "#BA8E23",
								color: "var(--text-color)",
								padding: "2px 6px",
								borderRadius: "4px",
								height: "fit-content",
								marginTop: "auto",
								marginBottom: "auto",
								textWrap: "nowrap",
							}}>
							{station?.vCenter === true
								? "V center"
								: "Iz centra"}
						</span>
					)}
				</div>
				<br></br>
				<ul className="station-info">
					{station?.routes_on_stop
						?.slice(0, 6)
						.map((route, index) => (
							<li key={index}>
								<p>{route}</p>
							</li>
						))}
					{station?.routes_on_stop?.length > 6 && (
						<li>
							<p>+ {station.routes_on_stop.length - 6}</p>
						</li>
					)}
				</ul>
			</div>
			{showDistance && station?.distance && (
				<span className="distance">
					{station.distance.toFixed(1)} km
				</span>
			)}
			<button
				className={`like-btn ${isLiked ? "liked" : ""}`}
				onClick={onToggleLike}
				aria-label={
					isLiked
						? "Odstrani iz priljubljenih"
						: "Dodaj med priljubljene"
				}>
				<Heart size={20} fill={isLiked ? "currentColor" : "none"} />
			</button>
		</div>
	),
);

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
	} catch {
		// Storage may be unavailable in private browsing.
	}
};

const loadSearchTerm = () => {
	try {
		return localStorage.getItem(STATION_SEARCH_KEY) || "";
	} catch {
		return "";
	}
};

const StationsTab = ({ userLocation, setActiveStation, busStops, szStops }) => {
	const [searchTerm, setSearchTerm] = useState(loadSearchTerm);
	const [debouncedSearchTerm, setDebouncedSearchTerm] = useState("");
	const [page, setPage] = useState("nearMe"); // nearMe, all, liked
	const [likedStations, setLikedStations] = useState(() =>
		loadLikedItems(LIKED_STATIONS_KEY),
	);
	const [radius] = useState(() => {
		const stored = localStorage.getItem("stationRadius");
		return stored ? JSON.parse(stored) : { busRadius: 5, szRadius: 20 };
	});

	useEffect(() => {
		try {
			localStorage.setItem(STATION_SEARCH_KEY, searchTerm);
		} catch {
			// Storage may be unavailable in private browsing.
		}
	}, [searchTerm]);

	// Debounce search term for better performance
	useEffect(() => {
		const timer = setTimeout(() => {
			setDebouncedSearchTerm(searchTerm);
		}, 300);
		return () => clearTimeout(timer);
	}, [searchTerm]);

	// Calculate distances and create allStations in one memo
	const allStations = useMemo(() => {
		const toRadians = (degrees) => degrees * (Math.PI / 180);
		const earthRadius = 6371;

		const calculateDistance = (stop) => {
			const lat1 = userLocation[0];
			const lon1 = userLocation[1];
			const lat2 = stop.gpsLocation?.[0] ?? stop.lat;
			const lon2 = stop.gpsLocation?.[1] ?? stop.lon;
			const dLat = toRadians(lat2 - lat1);
			const dLon = toRadians(lon2 - lon1);

			const a =
				Math.sin(dLat / 2) * Math.sin(dLat / 2) +
				Math.cos(toRadians(lat1)) *
					Math.cos(toRadians(lat2)) *
					Math.sin(dLon / 2) *
					Math.sin(dLon / 2);
			const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
			return earthRadius * c;
		};

		return [
			...busStops.map((stop) => ({
				...stop,
				type: "bus",
				distance: calculateDistance(stop),
			})),
			...szStops.map((stop) => ({
				...stop,
				type: "sz",
				distance: calculateDistance(stop),
			})),
		];
	}, [busStops, szStops, userLocation]);

	// Get unique station ID for liking
	const getStationId = useCallback((station) => {
		return station?.ref_id || station?.gtfs_id || station?.ijpp_id;
	}, []);

	const isStationLiked = useCallback(
		(station) => {
			const id = getStationId(station);
			return likedStations.some((s) => s.id === id);
		},
		[likedStations, getStationId],
	);

	const toggleLikeStation = useCallback(
		(station, e) => {
			e?.stopPropagation();
			const id = getStationId(station);
			setLikedStations((prev) => {
				const exists = prev.some((s) => s.id === id);
				const newLiked = exists
					? prev.filter((s) => s.id !== id)
					: [...prev, { id, name: station.name, data: station }];
				saveLikedItems(LIKED_STATIONS_KEY, newLiked);
				return newLiked;
			});
		},
		[getStationId],
	);

	// Filtered stations for "Near Me"
	const nearMeStations = useMemo(() => {
		return allStations
			.filter((stop) => {
				const maxDistance =
					stop.type === "bus" ? radius?.busRadius : radius?.szRadius;
				return stop.distance <= maxDistance && stop.distance > 0;
			})
			.filter((stop) =>
				stop.name
					.toLowerCase()
					.includes(debouncedSearchTerm.toLowerCase()),
			)
			.sort((a, b) => a.distance - b.distance);
	}, [allStations, debouncedSearchTerm, radius]);

	const filteredAllStations = useMemo(() => {
		if (debouncedSearchTerm.length < 3) return [];
		return allStations
			.filter((stop) =>
				stop.name
					.toLowerCase()
					.includes(debouncedSearchTerm.toLowerCase()),
			)
			.sort((a, b) => a.name.localeCompare(b.name));
	}, [allStations, debouncedSearchTerm]);

	const filteredLikedStations = useMemo(() => {
		return likedStations.filter((liked) =>
			liked.name
				.toLowerCase()
				.includes(debouncedSearchTerm.toLowerCase()),
		);
	}, [likedStations, debouncedSearchTerm]);

	const handleStationSelect = useCallback(
		(station) => {
			setActiveStation(station);
			window.location.hash = "/lines";
			localStorage.setItem("activeStation", JSON.stringify(station));
		},
		[setActiveStation],
	);

	const listContainerRef = useRef(null);
	const [listHeight, setListHeight] = useState(400);

	const nearMeListRef = useRef(null);
	const allListRef = useRef(null);
	const likedListRef = useRef(null);

	const itemHeightsCache = useRef({});

	useEffect(() => {
		const container = listContainerRef.current;
		if (!container) return;

		let rafId = null;
		let lastHeight = null;

		const applyHeight = (height) => {
			if (!Number.isFinite(height)) return;
			const rounded = Math.round(height);
			if (rounded === lastHeight) return;
			lastHeight = rounded;
			setListHeight(Math.max(200, rounded));
		};

		const measure = () => {
			if (rafId) cancelAnimationFrame(rafId);
			rafId = requestAnimationFrame(() => {
				rafId = null;
				if (!container.isConnected) return;
				applyHeight(container.getBoundingClientRect().height);
			});
		};

		measure();

		let ro = null;
		if (typeof ResizeObserver !== "undefined") {
			ro = new ResizeObserver((entries) => {
				const entry = entries[0];
				if (!entry) return;
				const height =
					entry.contentBoxSize?.[0]?.blockSize ??
					entry.contentRect?.height;
				applyHeight(height);
			});
			ro.observe(container);
		} else {
			window.addEventListener("resize", measure);
		}

		return () => {
			if (rafId) cancelAnimationFrame(rafId);
			if (ro) ro.disconnect();
			else window.removeEventListener("resize", measure);
		};
	}, []);

	// Reset list cache when data changes
	useEffect(() => {
		itemHeightsCache.current = {};
		nearMeListRef.current?.resetAfterIndex(0);
	}, [nearMeStations]);

	useEffect(() => {
		itemHeightsCache.current = {};
		allListRef.current?.resetAfterIndex(0);
	}, [filteredAllStations]);

	useEffect(() => {
		itemHeightsCache.current = {};
		likedListRef.current?.resetAfterIndex(0);
	}, [filteredLikedStations]);

	// Estimate item height based on content
	const getItemHeight = useCallback((station, listKey, index) => {
		const cacheKey = `${listKey}-${index}`;
		if (itemHeightsCache.current[cacheKey]) {
			return itemHeightsCache.current[cacheKey];
		}
		// Base height: padding (20px) + icon/text row (~30px) + border (1px)
		let height = 52;
		// Add height for routes if present
		const routeCount = station?.routes_on_stop?.length || 0;
		if (routeCount > 0) {
			height += 26; // Route badges row
		}
		itemHeightsCache.current[cacheKey] = height;
		return height;
	}, []);

	const getNearMeItemSize = useCallback(
		(index) => {
			return getItemHeight(nearMeStations[index], "nearMe", index);
		},
		[nearMeStations, getItemHeight],
	);

	const getAllItemSize = useCallback(
		(index) => {
			return getItemHeight(filteredAllStations[index], "all", index);
		},
		[filteredAllStations, getItemHeight],
	);

	const getLikedItemSize = useCallback(
		(index) => {
			const liked = filteredLikedStations[index];
			return getItemHeight(liked?.data, "liked", index);
		},
		[filteredLikedStations, getItemHeight],
	);

	return (
		<div className="insideDiv">
			<h2>Postaje</h2>
			<input
				type="text"
				placeholder={
					page === "all"
						? "Vnesite vsaj 3 znake..."
						: "Išči postaje..."
				}
				className="search-input"
				value={searchTerm}
				onChange={(e) => setSearchTerm(e.target.value)}
			/>
			<div className="top-nav">
				<button
					className={page === "nearMe" ? "active" : ""}
					onClick={() => setPage("nearMe")}>
					V bližini
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

			<div className="results station-list" ref={listContainerRef}>
				{page === "nearMe" && (
					<>
						{nearMeStations.length === 0 && (
							<p className="empty-message">
								Ni postaj v bližini.
							</p>
						)}
						{nearMeStations.length > 0 && (
							<List
								ref={nearMeListRef}
								height={listHeight}
								itemCount={nearMeStations.length}
								itemSize={getNearMeItemSize}
								estimatedItemSize={50}
								width="100%"
								overscanCount={5}>
								{({ index, style }) => {
									const station = nearMeStations[index];
									return (
										<div style={style}>
											<StationItem
												key={`near-${index}`}
												station={station}
												isLiked={isStationLiked(
													station,
												)}
												onToggleLike={(e) =>
													toggleLikeStation(
														station,
														e,
													)
												}
												onSelect={() =>
													handleStationSelect(station)
												}
												showDistance={true}
											/>
										</div>
									);
								}}
							</List>
						)}
					</>
				)}

				{page === "all" && (
					<>
						{searchTerm.length < 3 && (
							<p className="empty-message">
								Vnesite vsaj 3 znake za iskanje.
							</p>
						)}
						{searchTerm.length >= 3 &&
							filteredAllStations.length === 0 && (
								<p className="empty-message">Ni rezultatov.</p>
							)}
						{filteredAllStations.length > 0 && (
							<List
								ref={allListRef}
								height={listHeight}
								itemCount={filteredAllStations.length}
								itemSize={getAllItemSize}
								estimatedItemSize={50}
								width="100%"
								overscanCount={5}>
								{({ index, style }) => {
									const station = filteredAllStations[index];
									return (
										<div style={style}>
											<StationItem
												key={`all-${index}`}
												station={station}
												isLiked={isStationLiked(
													station,
												)}
												onToggleLike={(e) =>
													toggleLikeStation(
														station,
														e,
													)
												}
												onSelect={() =>
													handleStationSelect(station)
												}
												showDistance={true}
											/>
										</div>
									);
								}}
							</List>
						)}
					</>
				)}

				{page === "liked" && (
					<>
						{filteredLikedStations.length === 0 && (
							<p className="empty-message">
								Ni priljubljenih postaj. Kliknite na ❤️ za
								dodajanje.
							</p>
						)}
						{filteredLikedStations.length > 0 && (
							<List
								ref={likedListRef}
								height={listHeight}
								itemCount={filteredLikedStations.length}
								itemSize={getLikedItemSize}
								estimatedItemSize={50}
								width="100%"
								overscanCount={5}>
								{({ index, style }) => {
									const liked = filteredLikedStations[index];
									return (
										<div style={style}>
											<StationItem
												key={`liked-${index}`}
												station={liked.data}
												isLiked={true}
												onToggleLike={(e) =>
													toggleLikeStation(
														liked.data,
														e,
													)
												}
												onSelect={() =>
													handleStationSelect(
														liked.data,
													)
												}
												showDistance={true}
											/>
										</div>
									);
								}}
							</List>
						)}
					</>
				)}
			</div>
		</div>
	);
};

export default StationsTab;
