// Página pública de compra de entradas (sin login).
// DEMOSTRACIÓN: los partidos y precios vienen de la base real (RPC cartelera, que solo
// expone lo que sale en un afiche), pero el pago es simulado y los códigos se inventan aquí,
// así que no existen en la base y la puerta los rechaza. En la versión real las entradas las
// crea el servidor solo cuando la pasarela confirma el pago.
(function () {
    'use strict';

    const SUPABASE_URL = 'https://hcxyxcfipnqdgpppbqed.supabase.co';
    const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhjeHl4Y2ZpcG5xZGdwcHBicWVkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI1MDk4OTksImV4cCI6MjEwODA4NTg5OX0.rUijoO2Zo9hGxFLv1x4le53jV5ZB66rqK9BX39uJMtA';
    const MAXIMO_POR_LOCALIDAD = 10;
    const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // el mismo de privado.nuevo_codigo()

    if (!window.supabase || typeof window.supabase.createClient !== 'function') {
        console.error('No se cargó la librería de Supabase.');
        return;
    }
    const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    const $ = (id) => document.getElementById(id);
    let partidos = [];
    let partido = null;     // el elegido
    let cantidades = {};    // localidad_id -> cantidad

    // ---- Utilidades ----
    const formatoDinero = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
    const dinero = (n) => formatoDinero.format(n);

    function escapar(texto) {
        const div = document.createElement('div');
        div.textContent = texto == null ? '' : String(texto);
        return div.innerHTML;
    }

    function cuando(p) {
        const dia = new Date(p.fecha + 'T12:00:00').toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' });
        const texto = dia.charAt(0).toUpperCase() + dia.slice(1);
        if (!p.hora) return texto;
        const [h, m] = p.hora.split(':');
        const hora = new Date(2000, 0, 1, +h, +m).toLocaleTimeString('es', { hour: 'numeric', minute: '2-digit' });
        return `${texto} · ${hora}`;
    }

    const codigoVisible = (c) => `${c.slice(0, 5)}-${c.slice(5)}`;

    // Los dos escudos, el del club y el del rival (si ya lo subieron en Boletería).
    function escudos(p) {
        const rival = p.escudo
            ? `<img src="${escapar(db.storage.from('escudos').getPublicUrl(p.escudo).data.publicUrl)}" alt="Escudo de ${escapar(p.rival)}">`
            : '';
        return `<div class="escudos"><img src="img/logo.jpg" alt="Escudo del Atlético Balboa">${rival ? '<span>vs</span>' + rival : ''}</div>`;
    }

    function codigoDemo() {
        const bytes = crypto.getRandomValues(new Uint8Array(10));
        return Array.from(bytes, (b) => ALFABETO[b % ALFABETO.length]).join('');
    }

    function qrSvg(texto) {
        const qr = window.qrcode(0, 'M');
        qr.addData(texto);
        qr.make();
        const n = qr.getModuleCount();
        const margen = 4;
        let trazo = '';
        for (let r = 0; r < n; r++) {
            for (let c = 0; c < n; c++) {
                if (qr.isDark(r, c)) trazo += `M${c + margen},${r + margen}h1v1h-1z`;
            }
        }
        const lado = n + margen * 2;
        return `<svg viewBox="0 0 ${lado} ${lado}" shape-rendering="crispEdges" role="img" aria-label="Código QR">`
            + `<rect width="${lado}" height="${lado}" fill="#fff"/><path d="${trazo}" fill="#000"/></svg>`;
    }

    // ---- Paso 1: partidos ----
    async function cargarPartidos() {
        const { data, error } = await db.rpc('cartelera');
        const lista = $('listaPartidos');
        if (error) {
            lista.innerHTML = '<p class="error">No se pudieron cargar los partidos. Revisa tu conexión e inténtalo otra vez.</p>';
            return;
        }
        partidos = data.filter((p) => p.localidades.length);
        if (!partidos.length) {
            lista.innerHTML = '<p class="suave">Por ahora no hay partidos a la venta. Síguenos en redes para enterarte del próximo.</p>';
            return;
        }
        lista.innerHTML = partidos.map((p) => {
            const desde = Math.min(...p.localidades.map((l) => Number(l.precio)));
            return `<button type="button" class="partido" data-partido="${p.id}">
                ${p.escudo ? escudos(p) : ''}
                <div class="torneo">${escapar(p.torneo || 'Partido')}</div>
                <div class="rival">Atlético Balboa vs ${escapar(p.rival)}</div>
                <div>${escapar(cuando(p))}</div>
                <div class="desde">Desde ${dinero(desde)} ›</div>
            </button>`;
        }).join('');
    }

    $('listaPartidos').addEventListener('click', (e) => {
        const boton = e.target.closest('[data-partido]');
        if (boton) abrirPartido(Number(boton.dataset.partido));
    });

    // ---- Paso 2: localidades y datos ----
    function abrirPartido(id) {
        partido = partidos.find((p) => p.id === id);
        cantidades = {};
        $('partidoElegido').innerHTML = `<div class="rival">Atlético Balboa vs ${escapar(partido.rival)}</div>
            <div class="cuando">${escapar(cuando(partido))}${partido.torneo ? ' · ' + escapar(partido.torneo) : ''}</div>`;
        pintarLocalidades();
        mostrarPaso('pasoCompra');
    }

    function pintarLocalidades() {
        $('listaLocalidades').innerHTML = partido.localidades.map((l) => {
            const n = cantidades[l.id] || 0;
            const control = l.agotado
                ? '<span class="agotado">Agotado</span>'
                : `<div class="contador">
                    <button type="button" class="menos" data-menos="${l.id}" aria-label="Quitar una de ${escapar(l.nombre)}" ${n ? '' : 'disabled'}>−</button>
                    <span aria-live="polite">${n}</span>
                    <button type="button" data-mas="${l.id}" aria-label="Agregar una de ${escapar(l.nombre)}" ${n >= MAXIMO_POR_LOCALIDAD ? 'disabled' : ''}>+</button>
                </div>`;
            return `<div class="localidad">
                <div><div class="nombre">${escapar(l.nombre)}</div><div class="precio">${dinero(l.precio)}</div></div>
                ${control}
            </div>`;
        }).join('');

        const total = totalCompra();
        const boletos = Object.values(cantidades).reduce((a, b) => a + b, 0);
        $('btnPagar').disabled = !boletos;
        $('btnPagar').textContent = boletos
            ? `Pagar ${dinero(total)} (${boletos} ${boletos === 1 ? 'entrada' : 'entradas'})`
            : 'Elige al menos una entrada';
    }

    function totalCompra() {
        return partido.localidades.reduce((suma, l) => suma + (cantidades[l.id] || 0) * Number(l.precio), 0);
    }

    $('listaLocalidades').addEventListener('click', (e) => {
        const mas = e.target.closest('[data-mas]');
        const menos = e.target.closest('[data-menos]');
        if (mas) {
            const id = mas.dataset.mas;
            cantidades[id] = Math.min((cantidades[id] || 0) + 1, MAXIMO_POR_LOCALIDAD);
        } else if (menos) {
            const id = menos.dataset.menos;
            cantidades[id] = Math.max((cantidades[id] || 0) - 1, 0);
        } else {
            return;
        }
        pintarLocalidades();
    });

    $('btnVolver').addEventListener('click', () => mostrarPaso('pasoPartido'));

    $('datosForm').addEventListener('submit', (e) => {
        e.preventDefault();
        const nombre = $('cNombre').value.trim();
        const correo = $('cCorreo').value.trim();
        let problema = '';
        if (nombre.length < 3) problema = 'Escribe tu nombre completo.';
        else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) problema = 'Revisa tu correo: ahí te llegan las entradas.';
        $('datosError').textContent = problema;
        $('datosError').hidden = !problema;
        if (!problema) abrirPasarela();
    });

    // ---- Paso 3: pasarela simulada ----
    function abrirPasarela() {
        const total = dinero(totalCompra());
        $('pasarelaMonto').textContent = total;
        $('btnAprobar').textContent = `Pagar ${total}`;
        $('btnAprobar').disabled = false;
        $('pasarelaError').hidden = true;
        $('pasarela').hidden = false;
        $('btnAprobar').focus();
    }

    function cerrarPasarela() { $('pasarela').hidden = true; }

    $('btnCancelarPago').addEventListener('click', cerrarPasarela);

    $('btnRechazar').addEventListener('click', () => {
        $('pasarelaError').textContent = 'Tu banco rechazó el pago. No se te cobró nada. Prueba con otra tarjeta.';
        $('pasarelaError').hidden = false;
    });

    $('btnAprobar').addEventListener('click', () => {
        $('btnAprobar').disabled = true;
        $('btnAprobar').textContent = 'Procesando…';
        // Simula la espera del banco; en la real, la pasarela devuelve al aficionado a la página del club.
        setTimeout(() => {
            cerrarPasarela();
            mostrarEntradas();
        }, 1500);
    });

    // ---- Paso 4: entradas ----
    function mostrarEntradas() {
        const boletos = [];
        partido.localidades.forEach((l) => {
            for (let i = 0; i < (cantidades[l.id] || 0); i++) boletos.push({ localidad: l.nombre, codigo: codigoDemo() });
        });
        $('listoCorreo').textContent = `También te las enviamos a ${$('cCorreo').value.trim()}.`;
        $('boletos').innerHTML = boletos.map((b, i) => `<div class="boleto">
            <div class="boleto-banda">Atlético Balboa · Entrada ${i + 1} de ${boletos.length}</div>
            <div class="boleto-cuerpo">
                ${partido.escudo ? escudos(partido) : ''}
                <div class="rival">vs ${escapar(partido.rival)}</div>
                <div class="cuando">${escapar(cuando(partido))}</div>
                <div class="localidad-boleto">${escapar(b.localidad)}</div>
                <div class="qr">${qrSvg(b.codigo)}</div>
                <div class="codigo">${codigoVisible(b.codigo)}</div>
            </div>
            <div class="demo-sello">DEMOSTRACIÓN · NO VÁLIDA</div>
        </div>`).join('');
        mostrarPaso('pasoListo');
    }

    $('btnOtraCompra').addEventListener('click', () => {
        $('datosForm').reset();
        mostrarPaso('pasoPartido');
    });

    function mostrarPaso(id) {
        ['pasoPartido', 'pasoCompra', 'pasoListo'].forEach((p) => { $(p).hidden = p !== id; });
        window.scrollTo(0, 0);
    }

    cargarPartidos();
})();
