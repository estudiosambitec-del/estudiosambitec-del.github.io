/* Popups de arbolado y zonas verdes, ficha botánica y fotografías externas bajo demanda. */
(function () {
    'use strict';
    const catalog = window.GUIA_ESPECIES_GUADIX || {};
    const photoCache = new Map();
    const acceptedSynonyms = {
        'Prunus amygdalus': 'Prunus dulcis',
        'Sophora japonica': 'Styphnolobium japonicum',
        'Berberis aquifolium': 'Mahonia aquifolium',
        'Ulmus carpinifolia': 'Ulmus minor',
        'Rosmarinus officinalis': 'Salvia rosmarinus',
        'Callistemon citrinus': 'Melaleuca citrina',
        'Elaeagnus × submacrophylla': 'Elaeagnus × ebbingei',
        'Elaeagnus x submacrophylla': 'Elaeagnus × ebbingei'
    };
    async function timedFetch(url) {
        const controller = new AbortController();
        const timeout = setTimeout(function () { controller.abort(); }, 5000);
        try {
            return await fetch(url, { mode: 'cors', credentials: 'omit', signal: controller.signal });
        } finally { clearTimeout(timeout); }
    }


    function html(value) {
        return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
            return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c];
        });
    }
    function safeUrl(value) {
        try {
            const parsed = new URL(value);
            if (parsed.protocol !== 'https:') return '';
            return parsed.href;
        } catch (e) { return ''; }
    }
    function latinName(props) {
        const latin = String(props && props.ESPECIE != null ? props.ESPECIE : '').trim();
        return latin && latin !== 'Z Especie no identificada' ? latin : '';
    }
    function findCoords(feature, layer) {
        // A tree uses the actual GPS point, not the marker's visual centre.
        const geometry = feature && feature.geometry;
        if (geometry && geometry.type === 'MultiPoint' && geometry.coordinates.length) {
            const coord = geometry.coordinates[0];
            if (Number.isFinite(coord[0]) && Number.isFinite(coord[1])) return [coord[1], coord[0]];
        }
        if (geometry && geometry.type === 'Point' && geometry.coordinates.length === 2) {
            return [geometry.coordinates[1], geometry.coordinates[0]];
        }
        // Zones use a GEOS point-on-surface guaranteed to fall inside the polygon,
        // even for long concave areas and disconnected multipolygons.
        if (geometry && /Polygon/.test(geometry.type) && feature && feature.properties) {
            const fid = String(feature.properties.fid || '');
            const coord = window.DESTINOS_ZONAS_GUADIX && window.DESTINOS_ZONAS_GUADIX[fid];
            if (coord && coord.length === 2 && coord.every(Number.isFinite)) return coord;
        }
        // Fallback for new layers not present in the original static inventory.
        if (layer && typeof layer.getCenter === 'function') {
            try { const c = layer.getCenter(); return [c.lat, c.lng]; } catch (e) { /* fallback */ }
        }
        if (layer && typeof layer.getBounds === 'function') {
            try { const c = layer.getBounds().getCenter(); return [c.lat, c.lng]; } catch (e) { /* fallback */ }
        }
        return null;
    }
    function directionsButton(feature, layer) {
        const coords = findCoords(feature, layer);
        if (!coords || !coords.every(Number.isFinite)) return '';
        const lat = coords[0].toFixed(7);
        const lng = coords[1].toFixed(7);
        const url = 'https://www.google.com/maps/dir/?api=1&destination=' + lat + '%2C' + lng + '&travelmode=walking';
        return '<a class="ficha-directions" href="' + html(url) + '" target="_blank" rel="noopener noreferrer" title="Abrir la ruta a pie en Google Maps">' +
            '<span aria-hidden="true">↗</span> Cómo llegar</a>';
    }
    function fruitClass(text) {
        if (/precaución|preparaci|elaboración|procesad|cocinad|tratamiento|muy madur|sobremadur|requieren|variable/i.test(text)) return 'ficha-pill--neutral';
        return /^Sí/i.test(text) ? 'ficha-pill--positive' : 'ficha-pill--muted';
    }
    function pollenClass(text) {
        return text === 'Relevante' ? 'ficha-pill--attention' : (text === 'Posible' ? 'ficha-pill--neutral' : 'ficha-pill--muted');
    }
    function field(label, text, klass) {
        return '<div class="ficha-fact"><dt>' + html(label) + '</dt><dd' + (klass ? ' class="' + klass + '"' : '') + '>' + html(text) + '</dd></div>';
    }
    function treePopup(feature, layer, technicalTable) {
        const species = latinName(feature.properties);
        const data = catalog[species];
        const name = species || 'Especie no identificada';
        let content = '<div class="ficha-arbol">' +
            '<div class="ficha-heading"><div class="ficha-eyebrow">Ficha de la especie</div>' +
            '<h3>' + html(name) + '</h3>' +
            '<p class="ficha-common">' + (data ? html(data.comun) : 'Nombre común no disponible') + '</p></div>' +
            '<div class="ficha-actions">' + directionsButton(feature, layer) + '</div>';
        if (data) {
            content += '<div class="ficha-photo" data-photo-species="' + html(species) + '">' +
                '<div class="ficha-photo-placeholder" role="status">Buscando fotografía de referencia…</div></div>' +
                '<dl class="ficha-facts">' +
                field('Tipo de hoja', data.hoja) +
                field('Follaje', data.follaje) +
                field('Polen alergénico', data.polen, 'ficha-pill ' + pollenClass(data.polen)) +
                field('Frutos comestibles', data.fruto, 'ficha-fruit ' + fruitClass(data.fruto)) +
                '</dl>' +
                '<p class="ficha-disclaimer">Datos orientativos de la especie. El riesgo de alergia depende de la sensibilización individual y la exposición al polen. No recolectar ni consumir frutos urbanos sin garantías sanitarias.</p>';
        } else {
            content += '<p class="ficha-disclaimer ficha-unidentified">Este registro no permite identificar de forma fiable la especie ni asignarle una fotografía, tipo de hoja, carácter alergénico o comestibilidad.</p>';
        }
        content += '<details class="ficha-inventario"><summary>Datos del ejemplar y beneficios ecosistémicos</summary>' + technicalTable + '</details></div>';
        return content;
    }
    function zonePopup(feature, layer, technicalTable) {
        const type = String((feature.properties || {}).ESPACIO_FEMP || '').toLowerCase() === 'viario' ? 'Tramo de viario' : 'Zona verde';
        const name = String((feature.properties || {}).NOMBRE || '').trim() || 'Espacio sin nombre';
        return '<div class="ficha-zona"><div class="ficha-heading"><div class="ficha-eyebrow">' + html(type) + '</div>' +
            '<h3>' + html(name) + '</h3></div>' +
            '<div class="ficha-actions">' + directionsButton(feature, layer) + '</div>' +
            '<details class="ficha-inventario" open><summary>Datos del espacio</summary>' + technicalTable + '</details></div>';
    }
    function normalizeTaxon(input) {
        return String(input || '').toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/\b[x×]\b/g, 'x')
            .replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
    }
    function searchName(input) {
        let name = String(input || '').replace(/['‘’][^']*['‘’]/g, '').trim();
        // Nombre científico base de variedades ornamentales; la foto será de la especie.
        name = name.replace(/\s+(Fruitless|pendula|Bolleana|Umbraculifera)$/i, '');
        return name;
    }
    function canonBinomial(name) {
        const words = searchName(name).split(/\s+/);
        return words.length > 2 && /^(x|×)$/i.test(words[1]) ? words.slice(0, 3).join(' ') : words.slice(0, 2).join(' ');
    }
    async function wikipediaPhoto(species, lang) {
        const name = searchName(species);
        const url = 'https://' + lang + '.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(name.replace(/ /g, '_'));
        const response = await timedFetch(url);
        if (!response.ok) return null;
        const page = await response.json();
        if (page.type === 'disambiguation' || !page.thumbnail || !page.thumbnail.source) return null;
        // Reject a Wikipedia page whose title clearly refers to a different species.
        const pageTitle = normalizeTaxon(page.titles && page.titles.normalized ? page.titles.normalized : page.title);
        const expected = normalizeTaxon(canonBinomial(name));
        if (expected.split(' ').length > 1 && !pageTitle.startsWith(expected) &&
            !normalizeTaxon(page.extract).includes(expected)) return null;
        const image = safeUrl(page.thumbnail.source);
        if (!image) return null;
        let imagePage = '';
        try {
            const urlPath = new URL(page.thumbnail.source).pathname.split('/');
            const nameOfFile = decodeURIComponent(urlPath[urlPath.length - 2]);
            if (nameOfFile && /\.(jpg|jpeg|png|webp|svg)$/i.test(nameOfFile)) {
                imagePage = 'https://commons.wikimedia.org/wiki/File:' + encodeURIComponent(nameOfFile.replace(/ /g, '_'));
            }
        } catch (e) { /* fallback to article */ }
        return {
            url: image,
            credit: 'Wikimedia Commons · autoría y licencia de la foto',
            page: imagePage || safeUrl(page.content_urls && page.content_urls.desktop && page.content_urls.desktop.page) ||
                'https://' + lang + '.wikipedia.org/wiki/' + encodeURIComponent(name.replace(/ /g, '_'))
        };
    }
    async function inaturalistPhoto(species) {
        const name = canonBinomial(species);
        const url = 'https://api.inaturalist.org/v1/taxa/autocomplete?q=' + encodeURIComponent(name) + '&per_page=10&locale=es';
        const response = await timedFetch(url);
        if (!response.ok) return null;
        const result = await response.json();
        const wanted = normalizeTaxon(name);
        const entries = Array.isArray(result.results) ? result.results : [];
        // Exact match only: never substitute a similar but different taxon.
        const exact = entries.find(t => normalizeTaxon(t.name) === wanted && t.default_photo);
        if (!exact) return null;
        const photo = exact.default_photo;
        const image = safeUrl(photo.medium_url || photo.small_url);
        if (!image) return null;
        return {
            url: image,
            credit: (photo.attribution || 'Foto de iNaturalist') + (photo.license_code ? ' · ' + photo.license_code.toUpperCase() : ''),
            page: safeUrl('https://www.inaturalist.org/taxa/' + exact.id)
        };
    }
    async function fetchBestPhoto(species) {
        const canonical = canonBinomial(species);
        const alternative = acceptedSynonyms[species];
        // Prefer a freely licensed Wikipedia/Wikimedia image; then the current accepted name.
        for (const latin of [canonical, alternative].filter(Boolean)) {
            for (const lang of ['es', 'en']) {
                try { const photo = await wikipediaPhoto(latin, lang); if (photo) return photo; } catch (e) { /* try next source */ }
            }
        }
        for (const latin of [species, alternative].filter(Boolean)) {
            try { const photo = await inaturalistPhoto(latin); if (photo) return photo; } catch (e) { /* use fallback link */ }
        }
        return null;
    }
    function photoPromise(species) {
        const canonical = canonBinomial(species);
        if (!photoCache.has(canonical)) photoCache.set(canonical, fetchBestPhoto(species));
        return photoCache.get(canonical);
    }
    function textNode(tag, cls, value) {
        const element = document.createElement(tag);
        if (cls) element.className = cls;
        element.textContent = value;
        return element;
    }
    function fallbackPhoto(container, species) {
        container.replaceChildren();
        const div = textNode('div', 'ficha-photo-placeholder', 'Fotografía no disponible ahora.');
        const link = document.createElement('a');
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.href = 'https://commons.wikimedia.org/wiki/Special:MediaSearch?type=image&search=' + encodeURIComponent(canonBinomial(species));
        link.textContent = 'Buscar fotos de esta especie en Wikimedia Commons ↗';
        div.appendChild(link);
        container.appendChild(div);
    }
    function relayoutPopup(popup) {
        if (!popup || !popup.isOpen()) return;
        // popup.update() regenerates the HTML and would remove an asynchronously
        // inserted photograph. Update only its dimensions and position.
        if (typeof popup._updateLayout === 'function') popup._updateLayout();
        if (typeof popup._updatePosition === 'function') popup._updatePosition();
        if (typeof popup._adjustPan === 'function') popup._adjustPan();
    }
    async function hydratePhoto(container, popup) {
        const species = container.dataset.photoSpecies;
        if (!species) return;
        // Leaflet recreates the popup DOM on the initial open/auto-pan in some situations.
        // Locate the current node after the asynchronous request, not the old node.
        function currentContainer() {
            const root = popup && typeof popup.getElement === 'function' ? popup.getElement() : null;
            const current = root && root.querySelector('[data-photo-species]');
            return current && current.dataset.photoSpecies === species && current.isConnected ? current :
                (container.isConnected ? container : null);
        }
        try {
            const result = await photoPromise(species);
            const active = currentContainer();
            if (!active || !popup || !popup.isOpen()) return;
            if (!result || !result.url) { fallbackPhoto(active, species); return; }
            const fig = document.createElement('figure');
            fig.className = 'ficha-photo-figure';
            const img = document.createElement('img');
            img.className = 'ficha-species-img';
            img.src = result.url;
            img.alt = 'Fotografía ilustrativa de la especie ' + species;
            img.loading = 'eager';
            img.decoding = 'async';
            img.addEventListener('load', function () { relayoutPopup(popup); });
            img.addEventListener('error', function () { fallbackPhoto(active, species); relayoutPopup(popup); });
            const caption = document.createElement('figcaption');
            const link = document.createElement('a');
            link.href = result.page;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.textContent = result.credit;
            caption.appendChild(link);
            fig.appendChild(img);
            fig.appendChild(caption);
            active.replaceChildren(fig);
            relayoutPopup(popup);
        } catch (e) {
            const active = currentContainer();
            if (active) fallbackPhoto(active, species);
        }
    }
    function onTreePopupOpen(event) {
        const popup = event.popup;
        if (popup && popup.getElement()) {
            const imageContainer = popup.getElement().querySelector('[data-photo-species]');
            if (imageContainer) hydratePhoto(imageContainer, popup);
        }
    }
    window.FICHAS_GUADIX = { treePopup, zonePopup, onTreePopupOpen, directionsButton, catalog };
}());
