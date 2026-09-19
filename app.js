const state = {
	rows: [],
	importedRows: [],
	importedHeaders: [],
	importedCoordinates: {},
	groupingDistance: 200,
	paneToggleMode: 'map'
};

window.inspectState = () => {
	console.log(state);
};

const storageKey = 'walk-score-helper-state';
const geocodeCacheKey = 'walk-score-helper-geocoding';

const childWindowName = 'walkScoreSearch';

const selectors = {
	addresses: '#addresses',
	addressError: '#address-error',
	columnRow: '#column-row',
	columnSelect: '#column-select',
	latitudeColumnSelect: '#latitude-column-select',
	longitudeColumnSelect: '#longitude-column-select',
	fileInput: '#file-input',
	fileStatus: '#file-status',
	importSteps: '#import-steps',
	importButton: '#import-column',
	importMergeButton: '#import-merge',
	loadingMessage: '#loading-message',
	loadingOverlay: '#loading-overlay',
	groupingRadiusButton: '#adjust-grouping-radius',
	groupingRadiusCancel: '#cancel-grouping-radius',
	groupingRadiusDialog: '#grouping-radius-dialog',
	groupingRadiusForm: '#grouping-radius-form',
	groupingRadiusInput: '#grouping-radius-input',
	resultCount: '#result-count',
	scoreMap: '#score-map',
	scoreRows: '#score-rows',
	demoLink: '.hint.demo-link',
};

const streetTypes = [
    'Rd',
    'Ln',
    'Pl',
    'Dr',
    'St',
    'Ave',
    'Fwy',
    'Way',
    'Blvd',
];

const getElement = (selector) => document.querySelector(selector);
let scoreMap;
let markerSvgTemplatePromise;
let groupMarkers = new Map();
let markerLocations = [];

const mapPane = document.querySelector('.map-pane');
const searchPane = document.querySelector('.iframe-pane');
const searchIframe = document.getElementById('search-embed');

document.querySelectorAll('[data-toggle-pane]').forEach((button) => {
	button.addEventListener('click', (e) => {
		toggleMapSearch(e.currentTarget.getAttribute('data-toggle-pane'));
		saveAppState();
	});
});

document.querySelector('[data-reset-zoom]').addEventListener('click', resetMapZoom);

const expandToggles = document.querySelectorAll('[data-expand-pane]');
expandToggles.forEach((button) => {
	button.addEventListener('click', (e) => {
		const appLayout = getElement('.app-layout');
		appLayout.classList.toggle('expanded');
		expandToggles.forEach((b2) => {
			if (appLayout.classList.contains('expanded')) {
				b2.innerHTML = 'Collapse pane';
			} else {
				b2.innerHTML = 'Expand pane';
			}
			scoreMap.invalidateSize();
		});
	});
});



function getActiveStep() {
	return Number(document.querySelector('.step.active')?.id.replace('step-', '')) || 1;
}

function getExportValues() {
	return {
		csv: getElement('#csv-output').value,
		json: getElement('#json-output').value,
		geojson: getElement('#geojson-output').value
	};
}

function saveAppState() {
	const columnSelect = getElement(selectors.columnSelect);
	const snapshot = {
		addressText: getElement(selectors.addresses).value,
		columnIndex: columnSelect.value,
		latitudeColumnIndex: getElement(selectors.latitudeColumnSelect).value,
		longitudeColumnIndex: getElement(selectors.longitudeColumnSelect).value,
		exports: getExportValues(),
		fileStatus: getElement(selectors.fileStatus).textContent,
		groupingDistance: state.groupingDistance,
		importedHeaders: state.importedHeaders,
		importedCoordinates: state.importedCoordinates,
		importedRows: state.importedRows,
		rows: state.rows,
		scrollX: window.scrollX,
		scrollY: window.scrollY,
		step: getActiveStep(),
		paneToggleMode: state.paneToggleMode || 'map'
	};

	toggleSearchViewToggle();

	try {
		localStorage.setItem(storageKey, JSON.stringify(snapshot));
	} catch {
		// Saving can fail when browser storage is unavailable or full.
	}
}

function populateColumnSelect(selector, headers, selectedIndex, headerName, allowNone = false) {
	const select = getElement(selector);
	const detectedIndex = headers.findIndex((header) => header.toLowerCase().includes(headerName));
	const selectedValue = selectedIndex ?? (detectedIndex >= 0 ? String(detectedIndex) : allowNone ? '' : '0');
	const noneOption = allowNone ? '<option value="">(none)</option>' : '';
	const columnOptions = headers
		.map((header, index) => `<option value="${index}">${escapeHtml(header || `Column ${index + 1}`)}</option>`)
		.join('');

	select.innerHTML = noneOption + columnOptions;
	select.value = selectedValue;
}

function restoreImportedColumns(headers, selections = {}) {
	if (!headers.length) return;

	populateColumnSelect(selectors.columnSelect, headers, selections.address, 'address');
	populateColumnSelect(selectors.latitudeColumnSelect, headers, selections.latitude, 'latitude', true);
	populateColumnSelect(selectors.longitudeColumnSelect, headers, selections.longitude, 'longitude', true);
	getElement(selectors.columnRow).classList.add('visible');
}

function restoreSavedState() {
	let snapshot;
	try {
		snapshot = JSON.parse(localStorage.getItem(storageKey));
	} catch {
		return;
	}

	if (!snapshot || typeof snapshot !== 'object') return;

	state.rows = Array.isArray(snapshot.rows) ? snapshot.rows : [];
	state.importedRows = Array.isArray(snapshot.importedRows) ? snapshot.importedRows : [];
	state.importedHeaders = Array.isArray(snapshot.importedHeaders) ? snapshot.importedHeaders : [];
	state.importedCoordinates = snapshot.importedCoordinates || {};
	state.groupingDistance = Number(snapshot.groupingDistance) > 0 ? Number(snapshot.groupingDistance) : 200;
	getElement(selectors.groupingRadiusInput).value = state.groupingDistance;
	getElement(selectors.addresses).value = snapshot.addressText || '';
	getElement(selectors.fileStatus).textContent = snapshot.fileStatus || 'No file selected';
	restoreImportedColumns(state.importedHeaders, {
		address: snapshot.columnIndex,
		latitude: snapshot.latitudeColumnIndex,
		longitude: snapshot.longitudeColumnIndex
	});
	updateImportActions();

	state.paneToggleMode = snapshot.paneToggleMode || 'map';
	toggleMapSearch(state.paneToggleMode);
	toggleSearchViewToggle();
	if (state.paneToggleMode === 'map') {
		renderScoreMap();
	}
	
	if (state.rows.length) renderScoreRows();
	if (snapshot.exports) {
		getElement('#csv-output').value = snapshot.exports.csv || '';
		getElement('#json-output').value = snapshot.exports.json || '';
		getElement('#geojson-output').value = snapshot.exports.geojson || '';
	}

	const savedStep = Number(snapshot.step);
	const step = savedStep >= 1 && savedStep <= 3 && (savedStep === 1 || state.rows.length) ? savedStep : 1;
	navigateToStep(step, false);
	if (step === 2) requestAnimationFrame(renderScoreMap);
	requestAnimationFrame(() => window.scrollTo(snapshot.scrollX || 0, snapshot.scrollY || 0));
}

function escapeHtml(value) {
	const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' };
	return String(value).replace(/[&<>'"]/g, (character) => entities[character]);
}

function slugifyAddress(address) {
	return address
		.toLowerCase()
		.trim()
		.replace(/\b(street)\b/g, 'st')
		.replace(/\b(avenue)\b/g, 'ave')
		.replace(/\b(road)\b/g, 'rd')
		.replace(/\b(boulevard)\b/g, 'blvd')
		.replace(/\b(drive)\b/g, 'dr')
		.replace(/\b(lane)\b/g, 'ln')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');
}

function getScoreUrl(address) {
	return `https://www.walkscore.com/score/${slugifyAddress(address)}`;
}

function navigateToStep(step, shouldScroll = true) {
	document.querySelectorAll('.step').forEach((section) => {
		section.classList.toggle('active', section.id === `step-${step}`);
	});

	document.querySelectorAll('.progress span').forEach((segment, index) => {
		segment.classList.toggle('active', index < step);
	});

	if (shouldScroll) {
		saveAppState();
		window.scrollTo({ top: 0, behavior: 'smooth' });
	}
}

function parseScores(text) {
	const patterns = {
		walk: /\b(\d{1,3})\s+walk\s*score\b/i,
		transit: /\b(\d{1,3})\s+transit\s*score\b/i,
		bike: /\b(\d{1,3})\s+bike\s*score\b/i
	};

	return Object.fromEntries(
		Object.entries(patterns).map(([key, pattern]) => {
			const score = Number(text.match(pattern)?.[1]);
			return [key, Number.isInteger(score) && score >= 0 && score <= 100 ? score : ''];
		})
	);
}

function createScoreRowMarkup(row, index) {
	const address = escapeHtml(row.address);
	const previousRow = state.rows[index - 1];
	const groupClasses = [
		!previousRow || previousRow.groupId !== row.groupId ? 'group-start' : '',
		row.groupSize > 1 ? 'grouped' : ''
	].filter(Boolean).join(' ');
	const groupStyle = row.groupColor ? ` style="--group-color: ${row.groupColor}"` : '';
	return `<tr class="${groupClasses}" data-index="${index}"${groupStyle}>
		<td class="address">${address}</td>
		<td><a href="${getScoreUrl(row.address)}" data-open-score-search="${row.address}"><b>Open search</b></a><br><a href="#" data-copy-previous>Copy prior scores</a><br><a href="#" data-show-on-map>Show on map</a></td>
		<td><input aria-label="Walk Score for ${address}" type="number" min="0" max="100" value="${row.walk}"></td>
		<td><input aria-label="Transit Score for ${address}" type="number" min="0" max="100" value="${row.transit}"></td>
		<td><input aria-label="Bike Score for ${address}" type="number" min="0" max="100" value="${row.bike}"></td>
		<td><textarea aria-label="Paste score details for ${address}" placeholder="Paste Walk Score details here">${escapeHtml(row.paste)}</textarea></td>
	</tr>`;
}

function updateScoresFromInputs(row, inputs) {
	[row.walk, row.transit, row.bike] = [...inputs].map((input) => input.value);
	copyScoresToGroup(row);
}

function copyScoresToGroup(sourceRow) {
	state.rows.forEach((row, index) => {
		if (row === sourceRow || row.groupId !== sourceRow.groupId) return;

		row.walk = sourceRow.walk;
		row.transit = sourceRow.transit;
		row.bike = sourceRow.bike;
		const inputs = getElement(`${selectors.scoreRows} tr[data-index="${index}"]`).querySelectorAll('input');
		inputs[0].value = row.walk;
		inputs[1].value = row.transit;
		inputs[2].value = row.bike;
	});

	renderScoreMap();
}

function bindScoreRowEvents(tableRow) {
	const inputs = tableRow.querySelectorAll('input');
	const pasteBox = tableRow.querySelector('textarea');
	const row = state.rows[tableRow.dataset.index];
	const rowIndex = Number(tableRow.dataset.index);

	inputs.forEach((input) => {
		input.addEventListener('input', () => {
			updateScoresFromInputs(row, inputs);
			saveAppState();
		});
	});

	pasteBox.addEventListener('input', () => {
		row.paste = pasteBox.value;
		const scores = parseScores(pasteBox.value);
		inputs[0].value = row.walk = scores.walk;
		inputs[1].value = row.transit = scores.transit;
		inputs[2].value = row.bike = scores.bike;
		copyScoresToGroup(row);
		saveAppState();
	});

	tableRow.querySelector('[data-open-score-search]').addEventListener('click', (event) => {
		event.preventDefault();
		const target = event.currentTarget;
		if (target && target.classList.contains('disabled')) return;
		toggleMapSearch('search');
		if (searchIframe.src === target.href) return;

		const searchAddress = target.getAttribute('data-open-score-search');
		searchIframe.src = target.href;
		searchPane.classList.add('loading');
		const searchLinks = document.querySelectorAll('[data-open-score-search]');
		searchLinks.forEach(link => link.classList.add('disabled'));
		searchPane.setAttribute("data-search-address", searchAddress)
		searchIframe.addEventListener('load', () => {
			searchPane.classList.remove('loading');
			searchLinks.forEach(link => link.classList.remove('disabled'));
		});
	});

	tableRow.querySelector('[data-show-on-map]').addEventListener('click', async (event) => {
		event.preventDefault();
		if (state.paneToggleMode !== 'map') {
			toggleMapSearch('map');
		}
		if (!groupMarkers.has(row.groupId)) await renderScoreMap();
		const marker = groupMarkers.get(row.groupId);
		if (!marker) return;

		scoreMap.flyTo(marker.getLatLng(), 18, { duration: 0.5 });
		marker.openPopup();
	});

	tableRow.querySelector('[data-copy-previous]').addEventListener('click', (event) => {
		event.preventDefault();
		const previousRow = state.rows[rowIndex - 1];
		if (!previousRow) return;

		row.walk = previousRow.walk;
		row.transit = previousRow.transit;
		row.bike = previousRow.bike;
		inputs[0].value = row.walk;
		inputs[1].value = row.transit;
		inputs[2].value = row.bike;
		copyScoresToGroup(row);
		saveAppState();
	});
}

function toggleMapSearch(mode) {
	mapPane.style.display = mode === "map" ? "block" : "none";
	searchPane.style.display = mode === "search" ? "block" : "none";
	state.paneToggleMode = mode;

	if (scoreMap) {
		scoreMap.invalidateSize();
	}
}

function renderScoreRows() {
	const scoreRows = getElement(selectors.scoreRows);
	scoreRows.innerHTML = state.rows.map(createScoreRowMarkup).join('');
	scoreRows.querySelectorAll('tr').forEach(bindScoreRowEvents);
}

function quoteCsvValue(value) {
	const text = String(value ?? '');
	return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function createExportRecords() {
	return state.rows.map((row) => ({
		address: row.address,
		'walk score': Number(row.walk) || null,
		'bike score': Number(row.bike) || null,
		'transit score': Number(row.transit) || null
	}));
}

function createCsv(records) {
	const headings = ['address', 'walk score', 'bike score', 'transit score'];
	const rows = records.map((record) => [
		record.address,
		record['walk score'],
		record['bike score'],
		record['transit score']
	]);

	return [headings, ...rows].map((row) => row.map(quoteCsvValue).join(',')).join('\n');
}

function createGeoJson(records) {
	return {
		type: 'FeatureCollection',
		features: records.map((properties) => ({ type: 'Feature', properties, geometry: null }))
	};
}

function renderExports() {
	const records = createExportRecords();
	getElement(selectors.resultCount).textContent = records.length;
	getElement('#csv-output').value = createCsv(records);
	getElement('#json-output').value = JSON.stringify(records, null, 2);
	getElement('#geojson-output').value = JSON.stringify(createGeoJson(records), null, 2);
}

function parseDelimitedText(text, delimiter) {
	const rows = [];
	let currentCell = '';
	let currentRow = [];
	let insideQuotes = false;

	function addCell() {
		currentRow.push(currentCell.trim());
		currentCell = '';
	}

	function addRow() {
		addCell();
		if (currentRow.some(Boolean)) rows.push(currentRow);
		currentRow = [];
	}

	for (let index = 0; index < text.length; index += 1) {
		const character = text[index];
		const nextCharacter = text[index + 1];

		if (character === '"') {
			if (insideQuotes && nextCharacter === '"') {
				currentCell += '"';
				index += 1;
			} else {
				insideQuotes = !insideQuotes;
			}
		} else if (character === delimiter && !insideQuotes) {
			addCell();
		} else if ((character === '\n' || character === '\r') && !insideQuotes) {
			if (character === '\r' && nextCharacter === '\n') index += 1;
			addRow();
		} else {
			currentCell += character;
		}
	}

	if (currentCell || currentRow.length) addRow();
	return rows;
}

async function readSpreadsheet(file) {
	if (/\.xlsx?$/i.test(file.name)) {
		const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
		const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
		return XLSX.utils.sheet_to_json(firstSheet, { header: 1, defval: '' });
	}

	const delimiter = file.name.endsWith('.tsv') ? '\t' : ',';
	return parseDelimitedText(await file.text(), delimiter);
}

async function loadDemoFile() {
	const filename = 'sample-places.csv';
	const file = await fetch(filename);
	if (!file) throw Error('Demo file not found');
	file.name = file.url;

	getElement(selectors.fileStatus).textContent = file.name;
	try {
		const rows = await readSpreadsheet(file);
		const headers = rows.shift().map(String);
		state.importedRows = rows.filter(row => row.some(cell => /^\d/.test(String(cell).trim())));
		state.importedHeaders = headers;
		restoreImportedColumns(headers);
		updateImportActions();
		saveAppState();
		getElement(selectors.importSteps).style.display = 'block';
		importSelectedColumn();
	} catch (e) {
		getElement(selectors.fileStatus).textContent = 'Unable to read this file.';
	}
}

getElement(selectors.demoLink).addEventListener('click', loadDemoFile);

async function handleFileSelection(event) {
	const file = event.target.files[0];
	if (!file) return;

	getElement(selectors.fileStatus).textContent = file.name;
	try {
		const rows = await readSpreadsheet(file);
		const headers = rows.shift().map(String);
		state.importedRows = rows.filter(row => row.some(cell => /^\d/.test(String(cell).trim())));
		state.importedHeaders = headers;
		restoreImportedColumns(headers);
		updateImportActions();
		saveAppState();
		getElement(selectors.importSteps).style.display = 'block';
	} catch {
		getElement(selectors.fileStatus).textContent = 'Unable to read this file.';
	}
}

function sortAddresses(firstAddress, secondAddress) {
	const firstParts = firstAddress.split(/\s+/);
	const firstStreet = firstParts.slice(1).join(' ');
	const firstNumber = Number(firstParts[0].replace(/\D/g, '')) || 0;
	const secondParts = secondAddress.split(/\s+/);
	const secondStreet = secondParts.slice(1).join(' ');
	const secondNumber = Number(secondParts[0].replace(/\D/g, '')) || 0;

	const compareStreets = firstStreet.localeCompare(secondStreet);
	return compareStreets || firstNumber - secondNumber;
}

function getUniqueSortedAddresses(addresses) {
	return [...new Set(addresses.filter(hasValidStreetAddress))].toSorted(sortAddresses);
}

function normalizeAddress(address) {
	const streetTypePattern = streetTypes.join('|');
	const streetTypeToComma = new RegExp(`(\\b(?:${streetTypePattern})\\b)[^,]*(,)`, 'i');
	const normalizedAddress = address.replace(streetTypeToComma, '$1$2').trim();
	const addressParts = normalizedAddress.split(',').map((part) => part.trim());

	return addressParts.length > 4
		? [addressParts[0], ...addressParts.slice(-3)].join(', ')
		: normalizedAddress;
}

function hasValidStreetAddress(address) {
	const streetPart = address.split(',', 1)[0];
	return /^\d/.test(streetPart) && /[a-z]/i.test(streetPart) && /\d/.test(streetPart);
}

function getCoordinate(value) {
	const coordinate = Number(value);
	return Number.isFinite(coordinate) ? coordinate : null;
}

function getSelectedColumnIndex(selector) {
	const value = getElement(selector).value;
	return value === '' ? null : Number(value);
}

function getSelectedImportedEntries() {
	const addressColumnIndex = getSelectedColumnIndex(selectors.columnSelect);
	const latitudeColumnIndex = getSelectedColumnIndex(selectors.latitudeColumnSelect);
	const longitudeColumnIndex = getSelectedColumnIndex(selectors.longitudeColumnSelect);
	return state.importedRows
		.map((row) => ({
			address: normalizeAddress(String(row[addressColumnIndex] ?? '')),
			latitude: latitudeColumnIndex === null ? null : getCoordinate(row[latitudeColumnIndex]),
			longitude: longitudeColumnIndex === null ? null : getCoordinate(row[longitudeColumnIndex])
		}))
		.filter((entry) => hasValidStreetAddress(entry.address));
}

function updateImportActions() {
	const hasExistingAddresses = Boolean(getElement(selectors.addresses).value.trim());
	getElement(selectors.importButton).textContent = hasExistingAddresses
		? 'Import and replace addresses'
		: 'Import addresses';
	getElement(selectors.importMergeButton).hidden = !hasExistingAddresses;
}

function importSelectedColumn(shouldMerge = false) {
	const importedEntries = getSelectedImportedEntries();
	const importedAddresses = importedEntries.map((entry) => entry.address);
	const existingAddresses = shouldMerge
		? getElement(selectors.addresses).value.split(/\r?\n/).map((address) => address.trim())
		: [];
	const uniqueAddresses = getUniqueSortedAddresses([...existingAddresses, ...importedAddresses]);
	const importedCoordinates = Object.fromEntries(importedEntries
		.filter((entry) => entry.latitude !== null && entry.longitude !== null)
		.map((entry) => [entry.address, { latitude: entry.latitude, longitude: entry.longitude }])
	);
	state.importedCoordinates = shouldMerge
		? { ...state.importedCoordinates, ...importedCoordinates }
		: importedCoordinates;

	getElement(selectors.addresses).value = uniqueAddresses.join('\n');
	getElement(selectors.fileStatus).textContent = `${uniqueAddresses.length} addresses imported`;
	getElement(selectors.importSteps).style.display = 'none';
	saveAppState();
}

function showLoading(message) {
	getElement(selectors.loadingMessage).textContent = message;
	getElement(selectors.loadingOverlay).hidden = false;
}

function hideLoading() {
	getElement(selectors.loadingOverlay).hidden = true;
}

function hasCoordinates(row) {
	return Number.isFinite(row.latitude) && Number.isFinite(row.longitude);
}

function loadGeocodeCache() {
	try {
		return JSON.parse(localStorage.getItem(geocodeCacheKey)) || {};
	} catch {
		return {};
	}
}

function saveGeocodeCache(cache) {
	try {
		localStorage.setItem(geocodeCacheKey, JSON.stringify(cache));
	} catch {
		// Geocoding still works if the browser cannot persist its cache.
	}
}

async function geocodeAddress(address, cache) {
	if (Object.hasOwn(cache, address)) return cache[address];

	try {
		const response = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(address)}`);
		const [result] = await response.json();
		cache[address] = result ? { latitude: Number(result.lat), longitude: Number(result.lon) } : null;
	} catch {
		cache[address] = null;
	}

	saveGeocodeCache(cache);
	return cache[address];
}

function wait(milliseconds) {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function addMissingCoordinates() {
	const cache = loadGeocodeCache();
	const rowsWithoutCoordinates = state.rows.filter((row) => !hasCoordinates(row));

	for (const [index, row] of rowsWithoutCoordinates.entries()) {
		showLoading(`Locating address ${index + 1} of ${rowsWithoutCoordinates.length}...`);
		const coordinates = await geocodeAddress(row.address, cache);
		if (coordinates) Object.assign(row, coordinates);
		if (index < rowsWithoutCoordinates.length - 1) await wait(500);
	}
}

function groupRowsByProximity() {
	let groupNumber = 0;
	state.rows.forEach((row) => {
		row.groupId = null;
		row.groupColor = null;
		row.groupSize = 1;
	});

	for (const sourceRow of state.rows) {
		if (sourceRow.groupId) continue;

		const groupId = `group-${groupNumber += 1}`;
		sourceRow.groupId = groupId;
		if (!hasCoordinates(sourceRow)) continue;

		const groupRows = [sourceRow];
		for (const candidateRow of state.rows) {
			if (candidateRow.groupId || !hasCoordinates(candidateRow)) continue;
			const candidatePoint = turf.point([candidateRow.longitude, candidateRow.latitude]);
			const isWithinGroup = groupRows.every((groupRow) => {
				const groupPoint = turf.point([groupRow.longitude, groupRow.latitude]);
				return turf.distance(groupPoint, candidatePoint, { units: 'feet' }) <= state.groupingDistance;
			});
			if (isWithinGroup) {
				candidateRow.groupId = groupId;
				groupRows.push(candidateRow);
			}
		}
	}

	const groupOrder = [...new Set(state.rows.map((row) => row.groupId))];
	groupOrder.forEach((groupId) => {
		const rows = state.rows.filter((row) => row.groupId === groupId);
		if (rows.length < 2) return;

		const pastelColor = `hsl(${Math.floor(Math.random() * 360)} 70% 92%)`;
		rows.forEach((row) => {
			row.groupColor = pastelColor;
			row.groupSize = rows.length;
		});
	});
	state.rows = groupOrder.flatMap((groupId) => state.rows.filter((row) => row.groupId === groupId));
}

function getAddressGroups() {
	const groups = new Map();
	state.rows.forEach((row) => {
		const rows = groups.get(row.groupId) || [];
		rows.push(row);
		groups.set(row.groupId, rows);
	});
	return groups;
}

function loadMarkerSvgTemplate() {
	if (!markerSvgTemplatePromise) {
		markerSvgTemplatePromise = fetch('walk-score-marker.svg')
			.then((response) => response.ok ? response.text() : null)
			.catch(() => null);
	}

	return markerSvgTemplatePromise;
}

function createWalkScoreMarkerIcon(svgTemplate, walkScore) {
	const documentFragment = new DOMParser().parseFromString(svgTemplate, 'image/svg+xml');
	const svg = documentFragment.querySelector('svg');
	const scoreText = documentFragment.querySelector('text');
	svg.setAttribute('width', '63');
	svg.setAttribute('height', '63');
	scoreText.textContent = String(walkScore);

	return L.divIcon({
		html: new XMLSerializer().serializeToString(svg),
		className: 'walk-score-marker',
		iconSize: [63, 63],
		iconAnchor: [31.5, 63],
		popupAnchor: [0, -63],
		tooltipAnchor: [0, -52]
	});
}

async function renderScoreMap() {
	if (!window.L || !getElement(selectors.scoreMap)) return;
	const markerSvgTemplate = await loadMarkerSvgTemplate();
	if (scoreMap) scoreMap.remove();
	groupMarkers = new Map();

	scoreMap = L.map(getElement(selectors.scoreMap), {
		zoomSnap: 0.25,
    	zoomDelta: 0.25
	});
	L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
		attribution: '&copy; OpenStreetMap contributors'
	}).addTo(scoreMap);

	markerLocations = [];
	for (const rows of getAddressGroups().values()) {
		const markerRow = rows.find(hasCoordinates);
		if (!markerRow) continue;

		const walkScore = markerRow.walk || '-';
		const popupAddresses = rows.map((row) => `<li>${escapeHtml(row.address)}</li>`).join('');
		const popup = `<strong>Walk Score: ${escapeHtml(walkScore)}</strong><br>Bike Score: ${escapeHtml(markerRow.bike || '-')}<br>Transit Score: ${escapeHtml(markerRow.transit || '-')}<ul>${popupAddresses}</ul>`;
		const icon = markerSvgTemplate ? createWalkScoreMarkerIcon(markerSvgTemplate, walkScore) : undefined;
		const marker = L.marker([markerRow.latitude, markerRow.longitude], icon ? { icon } : undefined)
			.addTo(scoreMap)
			.bindPopup(popup);
		groupMarkers.set(markerRow.groupId, marker);
		markerLocations.push([markerRow.latitude, markerRow.longitude]);
	}

	resetMapZoom();
}

function resetMapZoom() {
	scoreMap.invalidateSize();
	if (!markerLocations || !scoreMap) return;
	if (markerLocations.length === 1) scoreMap.setView(markerLocations[0], 16);
	if (markerLocations.length > 1) scoreMap.fitBounds(markerLocations, { padding: [24, 24] });
}

async function advanceToScoreCollection() {
	const addresses = getUniqueSortedAddresses(getElement(selectors.addresses).value
		.split(/\r?\n/)
		.map((address) => normalizeAddress(address.replace('"', '').trim()))
		.filter(Boolean));

	if (!addresses.length) {
		getElement(selectors.addressError).textContent = 'Enter or import at least one address.';
		return;
	}

	getElement(selectors.addressError).textContent = '';
	const existingRowsByAddress = new Map(state.rows.map((row) => [row.address, row]));
	const uniqueAddresses = [...new Set(addresses)];
	state.rows = uniqueAddresses.map((address) => {
		const existingRow = existingRowsByAddress.get(address);
		const importedCoordinates = state.importedCoordinates[address];
		if (existingRow) {
			return {
				...existingRow,
				latitude: getCoordinate(existingRow.latitude) ?? importedCoordinates?.latitude ?? null,
				longitude: getCoordinate(existingRow.longitude) ?? importedCoordinates?.longitude ?? null
			};
		}

		return {
			address,
			walk: '',
			transit: '',
			bike: '',
			paste: '',
			latitude: importedCoordinates?.latitude ?? null,
			longitude: importedCoordinates?.longitude ?? null
		};
	});

	showLoading('Preparing score collection...');
	try {
		await addMissingCoordinates();
		groupRowsByProximity();
		renderScoreRows();
		navigateToStep(2);
		renderScoreMap();
		toggleMapSearch('map');
	} finally {
		hideLoading();
	}
}

async function copyExport(button) {
	const output = getElement(`#${button.dataset.copy}`);
	await navigator.clipboard.writeText(output.value);
	const originalLabel = button.textContent;
	button.textContent = 'Copied';
	setTimeout(() => { button.textContent = originalLabel; }, 1200);
}

function downloadExport(button) {
	const output = getElement(`#${button.dataset.download}`);
	const blob = new Blob([output.value], { type: button.dataset.type });
	const link = document.createElement('a');
	link.href = URL.createObjectURL(blob);
	link.download = button.dataset.name;
	link.click();
	URL.revokeObjectURL(link.href);
}

function toggleSearchViewToggle() {
	const searchToggleButton = getElement('[data-toggle-pane="search"]');
	if (searchIframe.src.toLowerCase().includes('walkscore.com')) {
		searchToggleButton.style.display = 'block';
	} else {
		searchToggleButton.style.display = 'none';
	}
}

function bindEvents() {
	getElement(selectors.fileInput).addEventListener('change', handleFileSelection);
	getElement(selectors.importButton).addEventListener('click', () => importSelectedColumn());
	getElement(selectors.importMergeButton).addEventListener('click', () => importSelectedColumn(true));
	getElement('#to-scores').addEventListener('click', advanceToScoreCollection);
	getElement('#to-export').addEventListener('click', () => {
		renderExports();
		navigateToStep(3);
	});

	document.querySelectorAll('[data-back]').forEach((button) => {
		button.addEventListener('click', () => navigateToStep(button.dataset.back));
	});
	document.querySelectorAll('[data-copy]').forEach((button) => {
		button.addEventListener('click', () => copyExport(button));
	});
	document.querySelectorAll('[data-download]').forEach((button) => {
		button.addEventListener('click', () => downloadExport(button));
	});

	document.addEventListener('input', saveAppState);
	document.addEventListener('change', saveAppState);
	document.addEventListener('click', () => toggleSearchViewToggle);
	window.addEventListener('pagehide', saveAppState);
	window.addEventListener('scroll', saveAppState, { passive: true });
}

bindEvents();
restoreSavedState();