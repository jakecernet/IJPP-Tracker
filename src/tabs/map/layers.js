import {
	CLUSTER_CONFIG,
	ICON_SIZE_BY_LAYER,
	ICON_ANCHOR_BY_LAYER,
	BRAND_COLORS,
	HALO_RADIUS,
} from "./config";

// Shared brand color expression for line/circle coloring
export const BRAND_COLOR_EXPR = [
	"match",
	["coalesce", ["get", "brand"], ["get", "icon"]],
	"arriva",
	BRAND_COLORS.arriva.stroke,
	"sz",
	BRAND_COLORS.sz.stroke,
	"nomago",
	BRAND_COLORS.nomago.stroke,
	"lpp",
	BRAND_COLORS.lpp.stroke,
	"marprom",
	BRAND_COLORS.marprom.stroke,
	"murska",
	BRAND_COLORS.arriva.stroke,
    "kranj",
    BRAND_COLORS.marprom.stroke,
	BRAND_COLORS.default.stroke,
];

const TRIP_LINE_WIDTH = [
	"interpolate",
	["linear"],
	["zoom"],
	10,
	3,
	14,
	5,
	16,
	7,
];

const EMPTY_LINE = {
	type: "Feature",
	geometry: { type: "LineString", coordinates: [] },
	properties: {},
};
const EMPTY_FEATURES = { type: "FeatureCollection", features: [] };

export function setupTripOverlay(map, prefix, colorExpr = BRAND_COLOR_EXPR) {
	const lineSrc = `${prefix}-trip-line-src`;
	const stopsSrc = `${prefix}-trip-stops-src`;
	const lineLayer = `${prefix}-trip-line`;
	const stopsLayer = `${prefix}-trip-stops-points`;

	if (!map.getSource(lineSrc)) {
		map.addSource(lineSrc, { type: "geojson", data: EMPTY_LINE });
	}
	if (!map.getLayer(lineLayer)) {
		map.addLayer({
			id: lineLayer,
			type: "line",
			source: lineSrc,
			paint: {
				"line-color": colorExpr,
				"line-width": TRIP_LINE_WIDTH,
				"line-opacity": 0.9,
			},
			layout: { "line-cap": "round", "line-join": "round" },
		});
	}
	if (!map.getSource(stopsSrc)) {
		map.addSource(stopsSrc, { type: "geojson", data: EMPTY_FEATURES });
	}
	if (!map.getLayer(stopsLayer)) {
		map.addLayer({
			id: stopsLayer,
			type: "circle",
			source: stopsSrc,
			paint: {
				"circle-color": colorExpr,
				"circle-radius": 6,
				"circle-stroke-color": "#ffffff",
				"circle-stroke-width": 2,
			},
		});
	}
}

export function clearTripOverlay(map, prefix) {
	const lineSrc = map.getSource(`${prefix}-trip-line-src`);
	const stopsSrc = map.getSource(`${prefix}-trip-stops-src`);
	if (lineSrc?.setData) lineSrc.setData(EMPTY_LINE);
	if (stopsSrc?.setData) stopsSrc.setData(EMPTY_FEATURES);
}

export function updateTripOverlay(
	map,
	prefix,
	lineCoords,
	stopsFeatures,
	brand,
) {
	const lineSrc = map.getSource(`${prefix}-trip-line-src`);
	const stopsSrc = map.getSource(`${prefix}-trip-stops-src`);

	const isMulti =
		lineCoords.length > 0 &&
		Array.isArray(lineCoords[0]) &&
		Array.isArray(lineCoords[0][0]);

	const lineData = {
		type: "Feature",
		geometry: isMulti
			? { type: "MultiLineString", coordinates: lineCoords }
			: { type: "LineString", coordinates: lineCoords },
		properties: { brand: brand || "generic" },
	};
	const stopsData = { type: "FeatureCollection", features: stopsFeatures };

	if (lineSrc?.setData) lineSrc.setData(lineData);
	if (stopsSrc?.setData) stopsSrc.setData(stopsData);
}

const HALO_COLOR_EXPR = [
	"match",
	["coalesce", ["get", "brand"], ["get", "icon"]],
	"arriva",
	BRAND_COLORS.arriva.fill,
	"sz",
	BRAND_COLORS.sz.fill,
	"nomago",
	BRAND_COLORS.nomago.fill,
	"lpp",
	BRAND_COLORS.lpp.fill,
	"marprom",
	BRAND_COLORS.marprom.fill,
	"murska",
	BRAND_COLORS.arriva.fill,
	"kranj",
	BRAND_COLORS.marprom.fill,
	BRAND_COLORS.default.fill,
];

const HALO_STROKE_EXPR = [
	"match",
	["coalesce", ["get", "brand"], ["get", "icon"]],
	"arriva",
	BRAND_COLORS.arriva.stroke,
	"sz",
	BRAND_COLORS.sz.stroke,
	"nomago",
	BRAND_COLORS.nomago.stroke,
	"lpp",
	BRAND_COLORS.lpp.stroke,
	"marprom",
	BRAND_COLORS.marprom.stroke,
	"murska",
	BRAND_COLORS.arriva.stroke,
	"kranj",
	BRAND_COLORS.marprom.stroke,
	BRAND_COLORS.default.stroke,
];

export function registerHaloLayer(map, prefix) {
	const id = `${prefix}-halo`;
	if (map.getLayer(id)) return;

	map.addLayer(
		{
			id,
			type: "circle",
			source: prefix,
			filter: ["!", ["has", "point_count"]],
			paint: {
				"circle-color": HALO_COLOR_EXPR,
				"circle-radius": HALO_RADIUS,
				"circle-stroke-color": HALO_STROKE_EXPR,
				"circle-stroke-width": 2.8,
				"circle-opacity": 0.6,
			},
		},
		`${prefix}-points`,
	);
}

function ensureSource(map, id, data, cluster, radius, maxZoom) {
	if (map.getSource(id)) return;
	map.addSource(id, {
		type: "geojson",
		data,
		cluster,
		clusterRadius: radius,
		clusterMaxZoom: maxZoom,
	});
}

function ensureClusterLayers(map, id, color) {
	if (!map.getLayer(`${id}-clusters`)) {
		map.addLayer({
			id: `${id}-clusters`,
			type: "circle",
			source: id,
			filter: ["has", "point_count"],
			paint: {
				"circle-color": color,
				"circle-radius": [
					"step",
					["get", "point_count"],
					14,
					10,
					18,
					50,
					22,
					100,
					26,
				],
				"circle-opacity": 0.85,
			},
		});
	}

	if (!map.getLayer(`${id}-cluster-count`)) {
		map.addLayer({
			id: `${id}-cluster-count`,
			type: "symbol",
			source: id,
			filter: ["has", "point_count"],
			layout: {
				"text-field": ["get", "point_count_abbreviated"],
				"text-font": ["Open Sans Semibold"],
				"text-size": 12,
				"text-allow-overlap": true,
			},
			paint: { "text-color": "#ffffff" },
		});
	}
}

function ensurePointLayer(map, id, iconSize, anchor) {
	if (map.getLayer(`${id}-points`)) return;

	// Vehicle layers (buses, trains) should always show on top
	const isVehicle = id === "buses" || id === "trainPositions";

	map.addLayer({
		id: `${id}-points`,
		type: "symbol",
		source: id,
		filter: ["!", ["has", "point_count"]],
		layout: {
			"icon-image": ["get", "icon"],
			"icon-allow-overlap": isVehicle,
			"icon-ignore-placement": isVehicle,
			"icon-size": iconSize,
			"icon-anchor": anchor,
			"symbol-sort-key": isVehicle ? 1 : 0,
		},
	});
}

function registerClusterInteraction(map, prefix) {
	map.on("click", `${prefix}-clusters`, (event) => {
		const features = map.queryRenderedFeatures(event.point, {
			layers: [`${prefix}-clusters`],
		});
		const clusterId = features[0]?.properties?.cluster_id;
		if (!clusterId) return;
		const source = map.getSource(prefix);
		source.getClusterExpansionZoom(clusterId, (err, zoom) => {
			if (err) return;
			map.easeTo({ center: features[0].geometry.coordinates, zoom });
		});
	});

	map.on("mouseenter", `${prefix}-clusters`, () => {
		map.getCanvas().style.cursor = "pointer";
	});
	map.on("mouseleave", `${prefix}-clusters`, () => {
		map.getCanvas().style.cursor = "";
	});
}

export function setupSourcesAndLayers(map, dataBySource) {
	Object.entries(CLUSTER_CONFIG).forEach(([id, config]) => {
		ensureSource(
			map,
			id,
			dataBySource[id],
			true,
			config.radius,
			config.maxZoom,
		);
		ensureClusterLayers(map, id, config.color);
		ensurePointLayer(
			map,
			id,
			ICON_SIZE_BY_LAYER[id],
			ICON_ANCHOR_BY_LAYER[id],
		);
		if (!["busStops", "trainStops"].includes(id)) {
			registerHaloLayer(map, id);
		}
		registerClusterInteraction(map, id);
	});
}

export function updateSourceData(map, id, data) {
	const source = map.getSource(id);
	if (!source?.setData || source.__v0Data === data) return;
	source.__v0Data = data;
	source.setData(data);
}

export function setPrefixVisible(map, prefix, visible) {
	const vis = visible ? "visible" : "none";
	const layers = [
		`${prefix}-points`,
		`${prefix}-clusters`,
		`${prefix}-cluster-count`,
		`${prefix}-halo`,
	];
	layers.forEach((layerId) => {
		if (map.getLayer(layerId) && map.getLayoutProperty(layerId, "visibility") !== vis) {
			map.setLayoutProperty(layerId, "visibility", vis);
		}
	});
}
