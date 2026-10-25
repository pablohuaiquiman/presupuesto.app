/* Informe de trabajo en PDF (estilo Report & Run): portada con datos del proyecto y bloques antes / después.
   Lo usan gastos.html (app de terreno) y Presupuestos Pro. Requiere html2pdf.js.
   Cada hoja mide exactamente una carta (816 × 1056 px), así el corte de páginas de html2pdf cae entre hojas. */
const InformePDF = (() => {
    const ANCHO = 816, ALTO = 1056;
    const h = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const fechaLarga = iso => {
        if (!iso) return '—';
        const ms = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
        const [y, m, d] = iso.slice(0, 10).split('-');
        return `${parseInt(d)} de ${ms[parseInt(m) - 1]} de ${y}`;
    };
    const texto = v => h(v).replace(/\n/g, '<br>');

    const CSS = `
    .ipdf, .ipdf * { box-sizing:border-box; margin:0; padding:0; }
    .ipdf-hoja { font-family:Arial,Helvetica,sans-serif; color:#0f172a; width:${ANCHO}px; height:${ALTO}px; overflow:hidden; background:#fff; padding:40px 44px 0; position:relative; }
    .ipdf-cab { display:flex; align-items:center; justify-content:space-between; border-bottom:3px solid #0f172a; padding-bottom:12px; }
    .ipdf-cab img { max-height:56px; max-width:180px; }
    .ipdf-cab .emp { font-size:11px; color:#475569; text-align:right; line-height:1.4; }
    .ipdf-cab .emp b { font-size:13px; color:#0f172a; }
    .ipdf-titulo { margin-top:22px; background:#0f172a; color:#fff; padding:14px 18px; border-radius:6px; }
    .ipdf-titulo small { display:block; font-size:10px; letter-spacing:2px; color:#94a3b8; font-weight:bold; }
    .ipdf-titulo div { font-size:20px; font-weight:bold; margin-top:3px; }
    .ipdf-datos { display:grid; grid-template-columns:1fr 1fr; gap:0; margin-top:14px; border:1px solid #cbd5e1; border-radius:6px; overflow:hidden; }
    .ipdf-datos div { padding:8px 12px; font-size:12px; border-bottom:1px solid #e2e8f0; }
    .ipdf-datos div:nth-child(odd) { border-right:1px solid #e2e8f0; }
    .ipdf-datos span { display:block; font-size:9px; color:#64748b; font-weight:bold; letter-spacing:1px; text-transform:uppercase; margin-bottom:2px; }
    .ipdf-sec { margin-top:14px; }
    .ipdf-sec h3 { font-size:11px; letter-spacing:1.5px; text-transform:uppercase; color:#1d4ed8; margin-bottom:5px; }
    .ipdf-sec p { font-size:12px; line-height:1.5; color:#334155; }
    .ipdf-bloque { margin-top:16px; border:1px solid #cbd5e1; border-radius:6px; overflow:hidden; }
    .ipdf-bloque .t { background:#f1f5f9; padding:7px 12px; font-size:13px; font-weight:bold; border-bottom:1px solid #cbd5e1; }
    .ipdf-bloque .t span { color:#1d4ed8; margin-right:6px; }
    .ipdf-par { display:grid; grid-template-columns:1fr 1fr; gap:10px; padding:10px 12px 0; }
    .ipdf-lado .et { font-size:10px; font-weight:bold; letter-spacing:1.5px; padding:3px 8px; border-radius:3px; display:inline-block; margin-bottom:5px; color:#fff; }
    .ipdf-lado .et.antes { background:#dc2626; } .ipdf-lado .et.despues { background:#059669; }
    .ipdf-fotos { display:grid; gap:4px; }
    .ipdf-foto { background-color:#e2e8f0; background-size:cover; background-position:center; border-radius:3px; }
    .ipdf-vacio { display:flex; align-items:center; justify-content:center; font-size:11px; color:#94a3b8; background:#f8fafc; border:1px dashed #cbd5e1; border-radius:3px; }
    .ipdf-com { max-height:64px; overflow:hidden; padding:8px 12px 10px; font-size:11.5px; color:#334155; line-height:1.45; }
    .ipdf-pie { position:absolute; left:44px; right:44px; bottom:22px; display:flex; justify-content:space-between; font-size:9.5px; color:#94a3b8; border-top:1px solid #e2e8f0; padding-top:6px; }
    .ipdf-firma { margin-top:60px; display:flex; justify-content:flex-end; }
    .ipdf-firma div { width:260px; border-top:1px solid #0f172a; text-align:center; padding-top:6px; font-size:11px; }
    .ipdf-firma small { display:block; color:#64748b; font-size:10px; }`;

    // alto: altura del área de fotos de cada lado, según cuántos bloques caben en la hoja.
    function lado(paths, urls, tipo, alto) {
        const lista = (paths || []).slice(0, 4);
        const etiqueta = `<div class="et ${tipo}">${tipo === 'antes' ? 'ANTES' : 'DESPUÉS'}</div>`;
        if (!lista.length) return `<div class="ipdf-lado">${etiqueta}<div class="ipdf-vacio" style="height:${alto}px">Sin fotografía</div></div>`;
        const cols = lista.length === 1 ? 1 : 2, filas = lista.length > 2 ? 2 : 1;
        const altoFoto = Math.floor((alto - (filas - 1) * 4) / filas);
        const fotos = lista.map(p => `<div class="ipdf-foto" style="height:${altoFoto}px;background-image:url('${urls.get(p) || ''}')"></div>`).join('');
        return `<div class="ipdf-lado">${etiqueta}<div class="ipdf-fotos" style="grid-template-columns:repeat(${cols},1fr)">${fotos}</div></div>`;
    }
    function bloque(it, i, urls, alto) {
        return `<div class="ipdf-bloque"><div class="t"><span>${i + 1}.</span>${h(it.titulo || 'Trabajo ' + (i + 1))}</div>
            <div class="ipdf-par">${lado(it.antes, urls, 'antes', alto)}${lado(it.despues, urls, 'despues', alto)}</div>
            <div class="ipdf-com">${it.comentario ? texto(it.comentario) : '&nbsp;'}</div></div>`;
    }

    // datos: { empresa, proyecto, informe, autor, cargarFoto: async path => URL usable por html2canvas }
    async function generar({ empresa, proyecto, informe, autor, cargarFoto }) {
        if (typeof html2pdf === 'undefined') throw new Error('No se pudo cargar el generador de PDF (revisa tu conexión)');
        const items = informe.items || [];
        const paths = [...new Set(items.flatMap(it => [...(it.antes || []).slice(0, 4), ...(it.despues || []).slice(0, 4)]))];
        const urls = new Map();
        await Promise.all(paths.map(async p => { try { urls.set(p, await cargarFoto(p)); } catch { /* foto sin acceso: queda gris */ } }));

        const nombreEmp = empresa?.razon_social || empresa?.nombre_comercial || '';
        const cabecera = `<div class="ipdf-cab">${empresa?.logo_b64 ? `<img src="${empresa.logo_b64}">` : `<b style="font-size:18px">${h(nombreEmp)}</b>`}
            <div class="emp">${empresa?.logo_b64 ? `<b>${h(nombreEmp)}</b><br>` : ''}${empresa?.rut ? `RUT ${h(empresa.rut)}` : ''}${empresa?.direccion ? `<br>${h(empresa.direccion)}` : ''}</div></div>`;
        const numero = `${proyecto?.codigo || ''} · ${fechaLarga(informe.fecha)}`;
        const hojas = [];
        // Hoja 1: datos y el primer bloque; luego dos bloques por hoja.
        const portada = `${cabecera}
            <div class="ipdf-titulo"><small>INFORME DE TRABAJO</small><div>${h(informe.titulo)}</div></div>
            <div class="ipdf-datos">
                <div><span>Proyecto</span>${h(proyecto ? `${proyecto.codigo} — ${proyecto.nombre}` : '—')}</div>
                <div><span>Fecha</span>${fechaLarga(informe.fecha)}</div>
                <div><span>Ubicación</span>${h(informe.ubicacion || '—')}</div>
                <div><span>Responsable</span>${h(autor || '—')}</div></div>
            ${informe.trabajo_realizado ? `<div class="ipdf-sec"><h3>Trabajo realizado</h3><p>${texto(String(informe.trabajo_realizado).slice(0, 600))}</p></div>` : ''}`;
        const resto = items.slice(1);
        hojas.push(portada + (items[0] ? bloque(items[0], 0, urls, informe.trabajo_realizado ? 250 : 320) : ''));
        for (let i = 0; i < resto.length; i += 2)
            hojas.push(cabecera + resto.slice(i, i + 2).map((it, k) => bloque(it, i + k + 1, urls, 300)).join(''));
        const cierre = `<div class="ipdf-sec" style="margin-top:22px"><h3>Observaciones</h3><p>${informe.observaciones ? texto(informe.observaciones) : 'Sin observaciones.'}</p></div>
            <div class="ipdf-firma"><div>${h(autor || '')}<small>${h(nombreEmp)}</small></div></div>`;
        // Las observaciones van en la última hoja si queda espacio (hoja con un solo bloque), si no en una hoja nueva.
        if (items.length === 0 || (resto.length % 2 === 1) || (items.length === 1 && !informe.trabajo_realizado)) hojas[hojas.length - 1] += cierre;
        else hojas.push(cabecera + cierre);

        const total = hojas.length;
        const styleEl = document.createElement('style');
        styleEl.textContent = CSS;
        document.head.appendChild(styleEl);
        // Fuera de pantalla pero en flujo normal (html2pdf necesita la altura real del contenido).
        const wrapper = document.createElement('div');
        wrapper.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;overflow:hidden;';
        wrapper.innerHTML = hojas.map((c, i) => `<div class="ipdf ipdf-hoja">${c}<div class="ipdf-pie"><span>${h(numero)}</span><span>Página ${i + 1} de ${total}</span></div></div>`).join('');
        document.body.appendChild(wrapper);
        const filename = `Informe ${proyecto?.codigo || ''} ${informe.fecha || ''}.pdf`.replace(/\s+/g, ' ').trim();
        try {
            // Una captura por hoja: un solo lienzo con todas las hojas supera el límite de los celulares (iOS ~16 MP).
            const elementos = [...wrapper.children];
            let worker = html2pdf().set({
                margin: 0, filename,
                image: { type: 'jpeg', quality: 0.9 },
                html2canvas: { scale: 2, useCORS: true, scrollX: 0, scrollY: 0 },
                jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' }, // carta = 816 × 1056 px a 96 ppp
                pagebreak: { mode: [] },
            }).from(elementos[0]).toPdf();
            for (const el of elementos.slice(1))
                worker = worker.get('pdf').then(pdf => pdf.addPage()).from(el).toContainer().toCanvas().toPdf();
            const blob = await worker.output('blob');
            return { blob, filename };
        } finally { wrapper.remove(); styleEl.remove(); }
    }

    // Descarga (o abre, en celulares que no descargan blobs) el PDF generado.
    function descargar({ blob, filename }) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
    }

    return { generar, descargar };
})();
