// Sistema Atlético Balboa — sesión, roles, navegación, movimientos y ajustes.
// Todo va dentro de una función (IIFE) para no crear variables globales que choquen
// con la librería: el CDN ya ocupa el nombre global "supabase".
// La seguridad real está en la base de datos (RLS); aquí solo se ocultan pantallas.
(function () {
    'use strict';

    // ---- Configuración ----
    const SUPABASE_URL = 'https://hcxyxcfipnqdgpppbqed.supabase.co';
    const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhjeHl4Y2ZpcG5xZGdwcHBicWVkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI1MDk4OTksImV4cCI6MjEwODA4NTg5OX0.rUijoO2Zo9hGxFLv1x4le53jV5ZB66rqK9BX39uJMtA'; // Supabase > Project Settings > API > anon public
    const LIMITE_HISTORIAL = 200;
    const ROLES = { dueno: 'Dueño', gerente: 'Gerente', secretaria: 'Secretaria', porteria: 'Portería' };

    // ---- Cliente de Supabase ----
    if (!window.supabase || typeof window.supabase.createClient !== 'function') {
        console.error('No se cargó la librería de Supabase. Revisa el <script> del CDN en index.html.');
        return;
    }
    // Se llama "db" (no "supabase") para no pisar la librería.
    const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    window.db = db; // accesible desde la consola y desde futuros módulos

    const $ = (id) => document.getElementById(id);
    let perfil = null;      // { user_id, email, nombre, rol }
    let categorias = [];    // todas, activas e inactivas

    // ---- Utilidades ----
    const formatoDinero = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
    const dinero = (n) => formatoDinero.format(n);

    function escapar(texto) {
        const div = document.createElement('div');
        div.textContent = texto == null ? '' : String(texto);
        return div.innerHTML;
    }

    function fechaCorta(iso) {
        const [a, m, d] = iso.split('-');
        return `${d}/${m}/${a}`;
    }

    function hoy() {
        const d = new Date();
        d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); // fecha local, no UTC
        return d.toISOString().slice(0, 10);
    }

    function avisar(elemento, texto, tipoMensaje) {
        elemento.textContent = texto;
        elemento.className = 'mensaje ' + (tipoMensaje || '');
    }

    const puede = (...roles) => perfil && roles.includes(perfil.rol);

    // ---- Inicio de sesión ----
    // Las cuentas se crean desde Supabase (Authentication > Users); el registro público está desactivado.
    const loginForm = $('loginForm');
    const loginMensaje = $('loginMensaje');

    function mostrarLogin() {
        apagarCamara();
        perfil = null;
        $('pantallaLogin').hidden = false;
        $('app').hidden = true;
        $('sesion').hidden = true;
        $('btnMenu').hidden = true;
        abrirMenu(false);
        $('pantallaActual').textContent = 'Control Financiero';
        document.title = 'Sistema Atlético Balboa';
    }

    async function entrarConSesion(session) {
        const { data, error } = await db
            .from('perfiles')
            .select('user_id, email, nombre, rol, activo')
            .eq('user_id', session.user.id)
            .maybeSingle();

        if (error || !data || !data.rol || !data.activo) {
            if (error) console.error('Error al cargar el perfil:', error);
            await db.auth.signOut();
            avisar(loginMensaje, 'Tu cuenta todavía no tiene acceso. Pide a un dueño del club que te asigne un rol.', 'error');
            return;
        }

        perfil = data;
        $('usuarioEmail').textContent = `${data.nombre || data.email} · ${ROLES[data.rol]}`;
        $('pantallaLogin').hidden = true;
        $('sesion').hidden = false;
        $('btnMenu').hidden = false;
        $('app').hidden = false;

        document.querySelectorAll('.nav a').forEach(a => {
            a.hidden = !a.dataset.roles.split(' ').includes(perfil.rol);
        });
        document.querySelectorAll('.solo-gestion').forEach(el => { el.hidden = !puede('dueno', 'gerente'); });
        $('tituloHistorial').textContent = puede('secretaria') ? 'Mis movimientos registrados' : 'Historial';

        if (perfil.rol !== 'porteria') await cargarCategorias(); // Portería solo valida entradas
        mostrarSeccion();
    }

    // No se llama a Supabase dentro del callback directamente (puede bloquear la sesión); se difiere.
    db.auth.onAuthStateChange((evento, session) => {
        if (evento === 'TOKEN_REFRESHED' || evento === 'USER_UPDATED') return;
        setTimeout(() => (session ? entrarConSesion(session) : mostrarLogin()), 0);
    });

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        $('btnEntrar').disabled = true;
        avisar(loginMensaje, 'Verificando...');

        const { error } = await db.auth.signInWithPassword({
            email: $('loginEmail').value.trim(),
            password: $('loginPassword').value
        });

        $('btnEntrar').disabled = false;
        if (error) {
            console.error('Error de inicio de sesión:', error);
            avisar(loginMensaje, 'Correo o contraseña incorrectos.', 'error');
            return;
        }
        avisar(loginMensaje, '');
        loginForm.reset();
    });

    $('btnSalir').addEventListener('click', () => db.auth.signOut());

    // ---- Navegación por secciones (#dashboard, #movimientos, ...) ----
    function mostrarSeccion() {
        if (!perfil) return;
        const inicio = perfil.rol === 'porteria' ? 'puerta' : 'movimientos';
        let id = location.hash.slice(1) || inicio;
        const enlace = document.querySelector(`.nav a[data-seccion="${CSS.escape(id)}"]`);
        if (!enlace || enlace.hidden) id = inicio;

        document.querySelectorAll('.seccion').forEach(s => s.classList.toggle('activa', s.id === id));
        document.querySelectorAll('.nav a').forEach(a => a.classList.toggle('activo', a.dataset.seccion === id));

        // En la barra de arriba siempre se ve en qué pantalla se está
        const nombre = document.querySelector(`.nav a[data-seccion="${id}"]`).textContent.trim();
        $('pantallaActual').textContent = nombre;
        document.title = `${nombre} · Atlético Balboa`;
        abrirMenu(false);
        window.scrollTo(0, 0);

        if (id === 'dashboard') cargarDashboard();
        if (id === 'planilla') cargarSeccionPlanilla();
        if (id === 'inventario') cargarInventario();
        if (id === 'boleteria') cargarBoleteria();
        if (id !== 'puerta') apagarCamara();
        if (id === 'movimientos') cargarHistorial();
        if (id === 'ajustes') { cargarUsuarios(); pintarCategorias(); pintarAjustesDocumentos(); }
        if (id === 'cuenta') $('cuentaDatos').textContent = `${perfil.email} · ${ROLES[perfil.rol]}`;
    }
    window.addEventListener('hashchange', mostrarSeccion);

    // ---- Menú lateral (botón de tres rayas) ----
    function abrirMenu(abrir) {
        document.body.classList.toggle('menu-abierto', abrir);
        $('btnMenu').setAttribute('aria-expanded', abrir);
        $('btnMenu').setAttribute('aria-label', abrir ? 'Cerrar menú' : 'Abrir menú');
        if (abrir) document.querySelector('.nav a.activo')?.focus();
    }
    $('btnMenu').addEventListener('click', () => abrirMenu(!document.body.classList.contains('menu-abierto')));
    $('velo').addEventListener('click', () => abrirMenu(false));
    // si se toca la pantalla en la que ya se está, no cambia el hash: se cierra igual
    $('menu').addEventListener('click', (e) => { if (e.target.closest('a')) abrirMenu(false); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') abrirMenu(false); });

    // ---- Categorías ----
    async function cargarCategorias() {
        const { data, error } = await db.from('categorias').select('id, nombre, tipo, activa, clave').order('id');
        if (error) {
            console.error('Error al cargar categorías:', error);
            return;
        }
        categorias = data;
        llenarCategoriasFormulario();
        $('fCategoria').innerHTML = '<option value="">Todas</option>' + categorias
            .map(c => `<option value="${c.id}">${escapar(c.nombre)}</option>`)
            .join('');
    }

    const nombreCategoria = (id) => (categorias.find(c => c.id === id) || {}).nombre || '—';

    // ---- Formulario "Registrar Movimiento" ----
    const form = $('transaccionForm');
    const tipo = $('tipo');
    const fecha = $('fecha');
    const mensaje = $('mensaje');

    function llenarCategoriasFormulario() {
        $('categoria').innerHTML = categorias
            .filter(c => c.activa && c.tipo === tipo.value)
            .map(c => `<option value="${c.id}">${escapar(c.nombre)}</option>`)
            .join('');
        alternarCamposArbitraje();
    }

    // Con la categoría Arbitraje se puede, de forma opcional, detallar los árbitros e imprimir sus recibos.
    // En ese caso el monto es la suma de lo pagado a cada árbitro.
    const esArbitraje = () => (categorias.find(c => c.id === Number($('categoria').value)) || {}).clave === 'arbitraje';
    const detallaArbitros = () => esArbitraje() && $('detallarArbitros').checked;

    function alternarCamposArbitraje() {
        const detalle = detallaArbitros();
        $('opcionArbitraje').hidden = !esArbitraje();
        $('camposArbitraje').hidden = $('camposArbitraje').disabled = !detalle;
        $('monto').readOnly = detalle;
        if (detalle) $('monto').value = arbitrosDelFormulario().reduce((s, a) => s + a.monto, 0).toFixed(2);
        $('btnGuardar').textContent = detalle ? 'Registrar pago e imprimir recibos' : 'Registrar Movimiento';
    }

    function limpiarFormulario() {
        form.reset();
        llenarCategoriasFormulario();
        fecha.value = hoy();
    }

    tipo.addEventListener('change', llenarCategoriasFormulario);
    $('categoria').addEventListener('change', alternarCamposArbitraje);
    $('detallarArbitros').addEventListener('change', alternarCamposArbitraje);
    fecha.value = hoy();

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        if (detallaArbitros()) {
            await registrarArbitraje();
            return;
        }

        const registro = {
            fecha: fecha.value,
            concepto: $('concepto').value.trim(),
            monto: Number($('monto').value),
            tipo: tipo.value,
            categoria_id: Number($('categoria').value),
            proveedor: $('proveedor').value.trim() || null,
            num_documento: $('numDocumento').value.trim() || null
        };
        const archivos = Array.from($('archivos').files);

        if (!registro.concepto || !(registro.monto > 0) || !registro.categoria_id) {
            avisar(mensaje, 'Revisa el concepto, la categoría y que el monto sea mayor a 0.', 'error');
            return;
        }
        const problema = revisarArchivos(archivos);
        if (problema) {
            avisar(mensaje, problema, 'error');
            return;
        }

        $('btnGuardar').disabled = true;
        avisar(mensaje, 'Guardando...');

        // Quién lo registró lo pone la base de datos (trigger), no el navegador.
        const { data, error } = await db.from('transacciones').insert([registro]).select('id').single();

        if (error) {
            $('btnGuardar').disabled = false;
            console.error('Error de Supabase:', error);
            avisar(mensaje, 'Error: ' + error.message, 'error');
            return;
        }

        let texto = '¡Movimiento guardado!';
        if (archivos.length) {
            avisar(mensaje, 'Subiendo comprobantes...');
            const fallidos = await subirComprobantes(data.id, archivos);
            texto = fallidos.length
                ? `Movimiento guardado, pero no se pudieron subir: ${fallidos.join(', ')}. Usa "Adjuntar" en el historial para intentarlo otra vez.`
                : `¡Movimiento guardado con ${archivos.length} comprobante${archivos.length > 1 ? 's' : ''}!`;
        }
        $('btnGuardar').disabled = false;
        avisar(mensaje, texto, texto.startsWith('¡') ? 'ok' : 'error');
        limpiarFormulario();
        cargarHistorial();
    });

    // ---- Comprobantes (tickets, recibos, facturas) ----
    // Se guardan en el almacenamiento privado de Supabase, en la carpeta del movimiento.
    const TIPOS_PERMITIDOS = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    const MAXIMO_BYTES = 10 * 1024 * 1024;

    function revisarArchivos(archivos) {
        const malo = archivos.find(a => !TIPOS_PERMITIDOS.includes(a.type));
        if (malo) return `"${malo.name}" no es una foto (JPG, PNG) ni un PDF.`;
        const grande = archivos.find(a => a.type === 'application/pdf' && a.size > MAXIMO_BYTES);
        if (grande) return `"${grande.name}" pesa más de 10 MB.`;
        return '';
    }

    // Las fotos del celular pesan varios MB: se reducen a 1600 px (sigue siendo legible) antes de subirlas.
    async function comprimirImagen(archivo) {
        if (!archivo.type.startsWith('image/')) return archivo;
        try {
            const imagen = await createImageBitmap(archivo);
            const escala = Math.min(1, 1600 / Math.max(imagen.width, imagen.height));
            const lienzo = document.createElement('canvas');
            lienzo.width = Math.round(imagen.width * escala);
            lienzo.height = Math.round(imagen.height * escala);
            lienzo.getContext('2d').drawImage(imagen, 0, 0, lienzo.width, lienzo.height);
            const blob = await new Promise(listo => lienzo.toBlob(listo, 'image/jpeg', 0.82));
            if (!blob || blob.size >= archivo.size) return archivo;
            return new File([blob], archivo.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
        } catch (_) {
            return archivo; // si el navegador no puede procesarla, se sube tal cual
        }
    }

    // Devuelve los nombres de los archivos que no se pudieron subir.
    async function subirComprobantes(transaccionId, archivos) {
        const fallidos = [];
        for (const original of archivos) {
            const archivo = await comprimirImagen(original);
            const extension = archivo.type === 'application/pdf' ? 'pdf' : archivo.type.split('/')[1].replace('jpeg', 'jpg');
            const ruta = `${transaccionId}/${crypto.randomUUID()}.${extension}`;

            const subida = await db.storage.from('comprobantes').upload(ruta, archivo, { contentType: archivo.type });
            const registro = subida.error ? subida : await db.from('comprobantes').insert([{
                transaccion_id: transaccionId, ruta, nombre: original.name.slice(0, 200), tipo: archivo.type, tamano: archivo.size
            }]);
            if (registro.error) {
                console.error('Error al subir comprobante:', registro.error);
                fallidos.push(original.name);
            }
        }
        return fallidos;
    }

    // El enlace dura 5 minutos: los archivos no son públicos.
    async function verComprobante(ruta) {
        const ventana = window.open('', '_blank'); // se abre ya, si no el navegador la bloquea
        const { data, error } = await db.storage.from('comprobantes').createSignedUrl(ruta, 300);
        if (error) {
            if (ventana) ventana.close();
            avisar(historialMensaje, 'No se pudo abrir el comprobante: ' + error.message, 'error');
            return;
        }
        if (ventana) ventana.location = data.signedUrl;
        else location.href = data.signedUrl;
    }

    // ---- Historial (la base ya filtra: la secretaria solo recibe lo suyo) ----
    const historial = $('historial');
    const historialMensaje = $('historialMensaje');
    let adjuntarA = null; // movimiento al que se le agregan comprobantes desde el historial

    async function cargarHistorial() {
        avisar(historialMensaje, 'Cargando...');

        let consulta = db
            .from('transacciones')
            .select('id, fecha, concepto, monto, tipo, categoria_id, proveedor, num_documento, registrado_email, anulada, '
                + 'anulada_email, anulada_en, motivo_anulacion, planilla_id, comprobantes(id, ruta, nombre), arbitrajes(id)')
            .order('fecha', { ascending: false })
            .order('id', { ascending: false })
            .limit(LIMITE_HISTORIAL);

        if ($('fDesde').value) consulta = consulta.gte('fecha', $('fDesde').value);
        if ($('fHasta').value) consulta = consulta.lte('fecha', $('fHasta').value);
        if ($('fTipo').value) consulta = consulta.eq('tipo', $('fTipo').value);
        if ($('fCategoria').value) consulta = consulta.eq('categoria_id', Number($('fCategoria').value));
        if (!$('fAnuladas').checked) consulta = consulta.eq('anulada', false);
        // Los pagos de planilla se respaldan con los recibos firmados de la propia planilla.
        if ($('fSinRespaldo').checked) consulta = consulta.eq('tipo', 'egreso').is('planilla_id', null).is('comprobantes', null);

        const { data, error } = await consulta;
        if (error) {
            console.error('Error al cargar historial:', error);
            avisar(historialMensaje, 'Error: ' + error.message, 'error');
            return;
        }

        pintarTotales(data);
        historial.innerHTML = data.map(filaMovimiento).join('');

        if (!data.length) avisar(historialMensaje, 'No hay movimientos con estos filtros.');
        else if (data.length === LIMITE_HISTORIAL) avisar(historialMensaje, `Se muestran los ${LIMITE_HISTORIAL} más recientes. Usa los filtros de fecha para ver otros.`);
        else avisar(historialMensaje, '');
    }

    const sinRespaldo = (m) => m.tipo === 'egreso' && !m.anulada && !m.planilla_id && !m.comprobantes.length;

    function pintarTotales(movs) {
        const vigentes = movs.filter(m => !m.anulada);
        const suma = (t) => vigentes.filter(m => m.tipo === t).reduce((s, m) => s + Number(m.monto), 0);
        const ingresos = suma('ingreso');
        const egresos = suma('egreso');
        const pendientes = movs.filter(sinRespaldo).length;
        $('totales').innerHTML = `
            <div><span>Ingresos</span><strong class="ingreso">${dinero(ingresos)}</strong></div>
            <div><span>Egresos</span><strong class="egreso">${dinero(egresos)}</strong></div>
            <div><span>Neto</span><strong>${dinero(ingresos - egresos)}</strong></div>
            <div><span>Egresos sin comprobante</span><strong class="${pendientes ? 'egreso' : ''}">${pendientes}</strong></div>`;
    }

    function filaMovimiento(m) {
        const signo = m.tipo === 'ingreso' ? '+' : '−';
        const anulacion = m.anulada
            ? `<div class="nota">Anulado por ${escapar(m.anulada_email)} el ${fechaCorta(m.anulada_en.slice(0, 10))}: ${escapar(m.motivo_anulacion)}</div>`
            : '';
        const detalle = [m.proveedor, m.num_documento && 'Doc. ' + m.num_documento].filter(Boolean).map(escapar).join(' · ');

        const archivos = m.comprobantes.map((c, i) =>
            `<button type="button" class="enlace" data-ver="${escapar(c.ruta)}" title="${escapar(c.nombre)}">📎 ${i + 1}</button>`).join(' ');
        let respaldo = archivos;
        if (m.planilla_id) respaldo = archivos || '<span class="ayuda-campo">Recibos de planilla</span>';
        else if (sinRespaldo(m)) respaldo = '<span class="falta">Sin comprobante</span>';
        if (!m.anulada) respaldo += ` <button type="button" class="btn-chico secundario" data-adjuntar="${m.id}">Adjuntar</button>`;
        const esArbitraje = Array.isArray(m.arbitrajes) ? m.arbitrajes.length > 0 : !!m.arbitrajes;
        if (esArbitraje) respaldo += ` <button type="button" class="btn-chico secundario" data-recibos-arbitraje="${m.id}">Recibos</button>`;

        // Los egresos de una planilla pagada se anulan juntos, revirtiendo el pago desde Planilla.
        let boton = '';
        if (!m.anulada && m.planilla_id) boton = '<span class="nota">Pago de planilla</span>';
        else if (!m.anulada && puede('dueno', 'gerente')) boton = `<button type="button" class="btn-chico" data-anular="${m.id}">Anular</button>`;
        return `
            <tr class="${m.anulada ? 'anulada' : ''}">
                <td>${fechaCorta(m.fecha)}</td>
                <td>${escapar(m.concepto)}${detalle ? `<small class="detalle">${detalle}</small>` : ''}${anulacion}</td>
                <td>${escapar(nombreCategoria(m.categoria_id))}</td>
                <td class="num ${m.tipo}">${signo}${dinero(m.monto)}</td>
                <td class="respaldo">${respaldo}</td>
                <td class="registro">${escapar(m.registrado_email)}</td>
                <td>${boton}</td>
            </tr>`;
    }

    $('filtrosForm').addEventListener('submit', (e) => {
        e.preventDefault();
        cargarHistorial();
    });

    historial.addEventListener('click', async (e) => {
        const boton = e.target.closest('button');
        if (!boton) return;

        if (boton.dataset.ver) {
            verComprobante(boton.dataset.ver);
            return;
        }
        if (boton.dataset.recibosArbitraje) {
            imprimirRecibosArbitraje(Number(boton.dataset.recibosArbitraje));
            return;
        }
        if (boton.dataset.adjuntar) {
            adjuntarA = Number(boton.dataset.adjuntar);
            $('archivoAdjuntar').value = '';
            $('archivoAdjuntar').click();
            return;
        }

        const id = boton.dataset.anular;
        if (!id) return;

        const motivo = prompt('¿Por qué se anula este movimiento? (queda registrado)');
        if (motivo === null) return;

        boton.disabled = true;
        const { error } = await db.rpc('anular_transaccion', { p_id: Number(id), p_motivo: motivo });
        if (error) {
            boton.disabled = false;
            avisar(historialMensaje, 'Error: ' + error.message, 'error');
            return;
        }
        cargarHistorial();
    });

    $('archivoAdjuntar').addEventListener('change', async () => {
        const archivos = Array.from($('archivoAdjuntar').files);
        if (!archivos.length || !adjuntarA) return;
        const problema = revisarArchivos(archivos);
        if (problema) {
            avisar(historialMensaje, problema, 'error');
            return;
        }
        avisar(historialMensaje, 'Subiendo comprobantes...');
        const fallidos = await subirComprobantes(adjuntarA, archivos);
        await cargarHistorial();
        if (fallidos.length) avisar(historialMensaje, `No se pudieron subir: ${fallidos.join(', ')}.`, 'error');
        else avisar(historialMensaje, 'Comprobantes agregados.', 'ok');
    });

    // ---- Dashboard (dueño y gerente) ----
    // La base devuelve totales ya agrupados por mes, tipo y categoría, sin anulados.
    let resumen = [];
    const NOMBRES_MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

    // "2026-10" → "oct 2026"
    const nombreMes = (clave) => `${NOMBRES_MES[Number(clave.slice(5, 7)) - 1]} ${clave.slice(0, 4)}`;

    // Claves "AAAA-MM" de los últimos n meses, del más antiguo al actual.
    function ultimosMeses(n) {
        const [a, m] = hoy().split('-').map(Number);
        return Array.from({ length: n }, (_, i) => {
            const d = new Date(a, m - 1 - (n - 1 - i), 1);
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        });
    }

    const sumar = (filas, t) => filas.filter(r => r.tipo === t).reduce((s, r) => s + Number(r.total), 0);

    async function cargarDashboard() {
        avisar($('dashboardMensaje'), 'Cargando...');
        const { data, error } = await db.rpc('resumen_mensual');
        if (error) {
            console.error('Error al cargar el resumen:', error);
            avisar($('dashboardMensaje'), 'Error: ' + error.message, 'error');
            return;
        }
        resumen = data.map(r => ({ ...r, mes: r.mes.slice(0, 7) }));
        avisar($('dashboardMensaje'), resumen.length ? '' : 'Todavía no hay movimientos registrados.');
        pintarKpis();
        pintarMeses();
        pintarCategoriasPeriodo();
    }

    function pintarKpis() {
        const actual = hoy().slice(0, 7);
        const delMes = resumen.filter(r => r.mes === actual);
        const saldo = sumar(resumen, 'ingreso') - sumar(resumen, 'egreso');
        const ingMes = sumar(delMes, 'ingreso');
        const egrMes = sumar(delMes, 'egreso');
        $('kpis').innerHTML = `
            <div class="kpi principal"><span>Saldo en caja</span><strong>${dinero(saldo)}</strong>
                <small>Todos los ingresos menos todos los egresos</small></div>
            <div class="kpi"><span>Ingresos de ${nombreMes(actual)}</span><strong>${dinero(ingMes)}</strong></div>
            <div class="kpi"><span>Egresos de ${nombreMes(actual)}</span><strong>${dinero(egrMes)}</strong></div>
            <div class="kpi"><span>Resultado del mes</span><strong>${dinero(ingMes - egrMes)}</strong></div>`;
    }

    function pintarMeses() {
        const meses = ultimosMeses(12).map(clave => {
            const filas = resumen.filter(r => r.mes === clave);
            return { clave, ingresos: sumar(filas, 'ingreso'), egresos: sumar(filas, 'egreso') };
        });
        const maximo = Math.max(1, ...meses.map(m => Math.max(m.ingresos, m.egresos)));
        const alto = (v) => v ? Math.max(2, (v / maximo) * 100) : 0; // un monto chico sigue visible

        $('graficoMeses').innerHTML = meses.map(m => `
            <div class="mes" title="${nombreMes(m.clave)}&#10;Ingresos: ${dinero(m.ingresos)}&#10;Egresos: ${dinero(m.egresos)}&#10;Resultado: ${dinero(m.ingresos - m.egresos)}">
                <div class="columnas-mes">
                    <i class="barra ingreso-bg" style="height:${alto(m.ingresos)}%"></i>
                    <i class="barra egreso-bg" style="height:${alto(m.egresos)}%"></i>
                </div>
                <span>${NOMBRES_MES[Number(m.clave.slice(5)) - 1]}</span>
            </div>`).join('');

        $('tablaMeses').innerHTML = meses.slice().reverse().map(m => `
            <tr>
                <td>${nombreMes(m.clave)}</td>
                <td class="num">${dinero(m.ingresos)}</td>
                <td class="num">${dinero(m.egresos)}</td>
                <td class="num">${dinero(m.ingresos - m.egresos)}</td>
            </tr>`).join('');
    }

    // Primer mes ("AAAA-MM") incluido en el periodo elegido; null = desde siempre.
    function inicioPeriodo(valor) {
        if (valor === 'todo') return null;
        if (valor === 'mes') return hoy().slice(0, 7);
        if (valor === 'anio') return hoy().slice(0, 4) + '-01';
        return ultimosMeses(Number(valor))[0];
    }

    function barrasCategorias(filas, t) {
        const porCategoria = {};
        filas.filter(r => r.tipo === t).forEach(r => {
            porCategoria[r.categoria_id] = (porCategoria[r.categoria_id] || 0) + Number(r.total);
        });
        const lista = Object.entries(porCategoria).sort((a, b) => b[1] - a[1]);
        if (!lista.length) return '<p class="ayuda">Sin movimientos en este periodo.</p>';

        const total = lista.reduce((s, [, v]) => s + v, 0);
        return lista.map(([id, valor]) => `
            <div class="barra-cat">
                <div class="barra-cat-texto">
                    <span>${escapar(nombreCategoria(Number(id)))}</span>
                    <strong>${dinero(valor)} <small>${Math.round((valor / total) * 100)}%</small></strong>
                </div>
                <div class="barra-cat-fondo"><i class="${t}-bg" style="width:${(valor / lista[0][1]) * 100}%"></i></div>
            </div>`).join('');
    }

    function pintarCategoriasPeriodo() {
        const desde = inicioPeriodo($('periodo').value);
        const filas = desde ? resumen.filter(r => r.mes >= desde) : resumen;
        $('catIngresos').innerHTML = barrasCategorias(filas, 'ingreso');
        $('catEgresos').innerHTML = barrasCategorias(filas, 'egreso');
    }

    $('periodo').addEventListener('change', pintarCategoriasPeriodo);

    // ---- Reportes: corte de caja entre dos fechas (dueño y gerente) ----
    let reporte = null; // último reporte generado, para exportarlo

    function fijarRango(rango) {
        const [a, m] = hoy().split('-').map(Number);
        const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        let desde, hasta;
        if (rango === 'mes') { desde = new Date(a, m - 1, 1); hasta = new Date(a, m, 0); }
        if (rango === 'anterior') { desde = new Date(a, m - 2, 1); hasta = new Date(a, m - 1, 0); }
        if (rango === 'anio') { desde = new Date(a, 0, 1); hasta = new Date(a, 11, 31); }
        $('rDesde').value = iso(desde);
        $('rHasta').value = iso(hasta);
    }
    fijarRango('mes');

    document.querySelector('.atajos').addEventListener('click', (e) => {
        if (!e.target.dataset.rango) return;
        fijarRango(e.target.dataset.rango);
        generarReporte();
    });

    $('reporteForm').addEventListener('submit', (e) => {
        e.preventDefault();
        generarReporte();
    });

    // Supabase entrega como máximo 1000 filas por consulta; se piden por páginas.
    async function movimientosDelPeriodo(desde, hasta) {
        const PAGINA = 1000;
        let todos = [];
        for (let inicio = 0; ; inicio += PAGINA) {
            const { data, error } = await db
                .from('transacciones')
                .select('id, fecha, concepto, monto, tipo, categoria_id, proveedor, num_documento, registrado_email, planilla_id, comprobantes(id)')
                .eq('anulada', false)
                .gte('fecha', desde)
                .lte('fecha', hasta)
                .order('fecha')
                .order('id')
                .range(inicio, inicio + PAGINA - 1);
            if (error) throw error;
            todos = todos.concat(data);
            if (data.length < PAGINA) return todos;
        }
    }

    async function generarReporte() {
        const aviso = $('reporteMensaje');
        const desde = $('rDesde').value;
        const hasta = $('rHasta').value;
        if (!desde || !hasta || desde > hasta) {
            avisar(aviso, 'Revisa las fechas: "Desde" debe ser anterior o igual a "Hasta".', 'error');
            return;
        }

        $('btnReporte').disabled = true;
        avisar(aviso, 'Generando...');
        try {
            const [movs, saldo] = await Promise.all([
                movimientosDelPeriodo(desde, hasta),
                db.rpc('saldo_al', { p_fecha: desde })
            ]);
            if (saldo.error) throw saldo.error;
            reporte = { desde, hasta, movs, saldoInicial: Number(saldo.data), generado: new Date() };
        } catch (error) {
            console.error('Error al generar el reporte:', error);
            avisar(aviso, 'Error: ' + error.message, 'error');
            return;
        } finally {
            $('btnReporte').disabled = false;
        }
        avisar(aviso, '');
        pintarReporte();
    }

    function totalesReporte(r) {
        const suma = (t) => r.movs.filter(m => m.tipo === t).reduce((s, m) => s + Number(m.monto), 0);
        const ingresos = suma('ingreso');
        const egresos = suma('egreso');
        return { ingresos, egresos, saldoFinal: r.saldoInicial + ingresos - egresos };
    }

    // [[nombre de categoría, total], ...] de mayor a menor
    function porCategoria(movs, t) {
        const acumulado = {};
        movs.filter(m => m.tipo === t).forEach(m => {
            const nombre = nombreCategoria(m.categoria_id);
            acumulado[nombre] = (acumulado[nombre] || 0) + Number(m.monto);
        });
        return Object.entries(acumulado).sort((a, b) => b[1] - a[1]);
    }

    function filasCategoria(lista) {
        if (!lista.length) return '<tr><td class="ayuda">Sin movimientos.</td></tr>';
        const total = lista.reduce((s, [, v]) => s + v, 0);
        return lista.map(([nombre, valor]) => `<tr><td>${escapar(nombre)}</td><td class="num">${dinero(valor)}</td></tr>`).join('')
            + `<tr class="total"><td>Total</td><td class="num">${dinero(total)}</td></tr>`;
    }

    // Texto de la columna "Respaldo" del corte de caja.
    function respaldoReporte(m) {
        if (m.comprobantes.length) return `${m.comprobantes.length} comprobante${m.comprobantes.length > 1 ? 's' : ''}`;
        if (m.planilla_id) return 'Recibos de planilla';
        return m.tipo === 'egreso' ? 'SIN COMPROBANTE' : '—';
    }

    function pintarReporte() {
        const r = reporte;
        const t = totalesReporte(r);
        $('reporte').hidden = false;
        $('reportePeriodo').textContent = `Del ${fechaCorta(r.desde)} al ${fechaCorta(r.hasta)}`;
        $('reporteTotales').innerHTML = `
            <div><span>Saldo inicial</span><strong>${dinero(r.saldoInicial)}</strong></div>
            <div><span>Ingresos</span><strong class="ingreso">${dinero(t.ingresos)}</strong></div>
            <div><span>Egresos</span><strong class="egreso">${dinero(t.egresos)}</strong></div>
            <div><span>Saldo final</span><strong>${dinero(t.saldoFinal)}</strong></div>`;
        $('reporteCatIngresos').innerHTML = filasCategoria(porCategoria(r.movs, 'ingreso'));
        $('reporteCatEgresos').innerHTML = filasCategoria(porCategoria(r.movs, 'egreso'));
        $('reporteDetalle').innerHTML = r.movs.length
            ? r.movs.map(m => `
                <tr>
                    <td>${fechaCorta(m.fecha)}</td>
                    <td>${escapar(m.concepto)}${m.proveedor || m.num_documento
                        ? `<small class="detalle">${[m.proveedor, m.num_documento && 'Doc. ' + m.num_documento].filter(Boolean).map(escapar).join(' · ')}</small>` : ''}</td>
                    <td>${escapar(nombreCategoria(m.categoria_id))}</td>
                    <td class="num ${m.tipo}">${m.tipo === 'ingreso' ? '+' : '−'}${dinero(m.monto)}</td>
                    <td class="${respaldoReporte(m) === 'SIN COMPROBANTE' ? 'falta' : 'registro'}">${respaldoReporte(m)}</td>
                    <td class="registro">${escapar(m.registrado_email)}</td>
                </tr>`).join('')
            : '<tr><td colspan="6" class="ayuda">No hay movimientos en este periodo.</td></tr>';
        const faltan = r.movs.filter(m => respaldoReporte(m) === 'SIN COMPROBANTE').length;
        $('reportePie').textContent = `${r.movs.length} movimientos · ${faltan} egresos sin comprobante · No incluye movimientos anulados · `
            + `Generado por ${perfil.nombre || perfil.email} el ${r.generado.toLocaleString('es')}`;
    }

    $('btnPdf').addEventListener('click', () => window.print());

    // La librería de Excel solo se descarga la primera vez que alguien exporta.
    function cargarLibreriaExcel() {
        if (window.XLSX) return Promise.resolve();
        return new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
            s.onload = resolve;
            s.onerror = () => reject(new Error('No se pudo descargar la librería de Excel. Revisa tu conexión.'));
            document.head.appendChild(s);
        });
    }

    $('btnExcel').addEventListener('click', async () => {
        const r = reporte;
        if (!r) return;
        try {
            await cargarLibreriaExcel();
        } catch (error) {
            avisar($('reporteMensaje'), error.message, 'error');
            return;
        }
        const t = totalesReporte(r);
        const libro = XLSX.utils.book_new();

        const resumen = [
            [`${CLUB} — Corte de caja`],
            ['Periodo', `${fechaCorta(r.desde)} al ${fechaCorta(r.hasta)}`],
            [],
            ['Saldo inicial', r.saldoInicial],
            ['Ingresos', t.ingresos],
            ['Egresos', t.egresos],
            ['Saldo final', t.saldoFinal],
            [],
            ['Ingresos por categoría'], ...porCategoria(r.movs, 'ingreso'),
            [],
            ['Egresos por categoría'], ...porCategoria(r.movs, 'egreso'),
            [],
            ['No incluye movimientos anulados.']
        ];
        const hojaResumen = XLSX.utils.aoa_to_sheet(resumen);
        hojaResumen['!cols'] = [{ wch: 34 }, { wch: 18 }];
        XLSX.utils.book_append_sheet(libro, hojaResumen, 'Resumen');

        const detalle = [['Fecha', 'Tipo', 'Concepto', 'Categoría', 'Proveedor o persona', 'N.º documento', 'Monto (USD)', 'Respaldo', 'Registró']]
            .concat(r.movs.map(m => [
                fechaCorta(m.fecha),
                m.tipo === 'ingreso' ? 'Ingreso' : 'Egreso',
                m.concepto,
                nombreCategoria(m.categoria_id),
                m.proveedor || '',
                m.num_documento || '',
                m.tipo === 'ingreso' ? Number(m.monto) : -Number(m.monto),
                respaldoReporte(m),
                m.registrado_email
            ]));
        const hojaDetalle = XLSX.utils.aoa_to_sheet(detalle);
        hojaDetalle['!cols'] = [{ wch: 11 }, { wch: 9 }, { wch: 40 }, { wch: 30 }, { wch: 28 }, { wch: 16 }, { wch: 14 }, { wch: 20 }, { wch: 30 }];
        XLSX.utils.book_append_sheet(libro, hojaDetalle, 'Movimientos');

        XLSX.writeFile(libro, `corte-caja_${r.desde}_a_${r.hasta}.xlsx`);
    });

    // ---- Documentos para imprimir (planilla y recibos) ----
    const CLUB = 'Club Deportivo Atlético Balboa';
    let ajustes = {}; // datos de quien firma por el club (tabla "ajustes")

    async function cargarAjustes() {
        const { data, error } = await db.from('ajustes').select('clave, valor');
        if (error) {
            console.error('Error al cargar ajustes:', error);
            return;
        }
        ajustes = Object.fromEntries(data.map(a => [a.clave, a.valor]));
    }

    function membrete(titulo, detalle) {
        return `
            <div class="membrete">
                <img src="img/logo.jpg" alt="">
                <div>
                    <strong>${CLUB}</strong>
                    <span>${escapar(titulo)}</span>
                    <small>${escapar(detalle)}</small>
                </div>
            </div>`;
    }

    // Arma el documento en #impresion y abre la ventana de imprimir (desde ahí se guarda como PDF).
    function imprimir(html) {
        $('impresion').innerHTML = html;
        document.body.classList.add('imprimiendo');
        const imagenes = Array.from($('impresion').querySelectorAll('img'));
        Promise.all(imagenes.map(img => img.complete ? null : new Promise(listo => { img.onload = img.onerror = listo; })))
            .then(() => window.print());
    }
    window.addEventListener('afterprint', () => document.body.classList.remove('imprimiendo'));

    // 538.33 → "QUINIENTOS TREINTA Y OCHO DÓLARES CON 33/100"
    function montoEnLetras(monto) {
        const UNIDADES = ['', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez',
            'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve', 'veinte',
            'veintiuno', 'veintidós', 'veintitrés', 'veinticuatro', 'veinticinco', 'veintiséis', 'veintisiete', 'veintiocho', 'veintinueve'];
        const DECENAS = ['', '', '', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'];
        const CENTENAS = ['', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos', 'seiscientos',
            'setecientos', 'ochocientos', 'novecientos'];
        // "uno" se acorta delante de un sustantivo: veintiún mil, un dólar
        const apocope = (t) => t.replace(/veintiuno$/, 'veintiún').replace(/uno$/, 'un');

        function hasta999(n) {
            if (n === 100) return 'cien';
            const r = n % 100;
            const resto = r < 30 ? UNIDADES[r] : DECENAS[Math.floor(r / 10)] + (r % 10 ? ' y ' + UNIDADES[r % 10] : '');
            return [CENTENAS[Math.floor(n / 100)], resto].filter(Boolean).join(' ');
        }

        const centavos = Math.round(Number(monto) * 100);
        const entero = Math.floor(centavos / 100);
        const millones = Math.floor(entero / 1e6);
        const miles = Math.floor(entero / 1000) % 1000;
        const partes = [];
        if (millones) partes.push(millones === 1 ? 'un millón' : apocope(hasta999(millones)) + ' millones');
        if (miles) partes.push(miles === 1 ? 'mil' : apocope(hasta999(miles)) + ' mil');
        if (entero % 1000) partes.push(hasta999(entero % 1000));
        const palabras = partes.length ? apocope(partes.join(' ')) : 'cero';
        return `${palabras} ${entero === 1 ? 'dólar' : 'dólares'} con ${String(centavos % 100).padStart(2, '0')}/100`.toUpperCase();
    }

    // ---- Planilla mensual (dueño y gerente) ----
    const GRUPOS = { jugador: 'Jugadores', cuerpo_tecnico: 'Cuerpo técnico', administrativo: 'Administrativos' };
    const GRUPO_PERSONA = { jugador: 'Jugador', cuerpo_tecnico: 'Cuerpo técnico', administrativo: 'Administrativo' };
    const ORDEN_GRUPOS = Object.keys(GRUPOS);
    const FORMAS_PAGO = { efectivo: 'Efectivo', transferencia: 'Transferencia', cheque: 'Cheque', otro: 'Otro' };
    const MESES_LARGOS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
        'septiembre', 'octubre', 'noviembre', 'diciembre'];
    // Orden del recibo del club: lo que se suma, y después lo que se resta.
    const CAMPOS_LINEA = ['salario', 'bonos', 'otros', 'multas', 'isr', 'descuentos'];

    let personal = [];
    let planilla = null; // fila de "planillas" con sus "lineas", o null si el mes no tiene planilla

    const ordenarPorGrupo = (a, b) =>
        ORDEN_GRUPOS.indexOf(a.grupo) - ORDEN_GRUPOS.indexOf(b.grupo) || a.nombre.localeCompare(b.nombre, 'es');
    const periodoElegido = () => `${$('plAnio').value}-${$('plMes').value}-01`;
    const nombrePeriodo = (iso) => `${MESES_LARGOS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
    const mayuscula = (t) => t.charAt(0).toUpperCase() + t.slice(1);
    const sumaCampo = (lineas, campo) => lineas.reduce((s, l) => s + Number(l[campo]), 0);
    const devengado = (l) => Number(l.salario) + Number(l.bonos) + Number(l.otros) - Number(l.multas);
    const opcionesFormaPago = (actual) => Object.entries(FORMAS_PAGO)
        .map(([valor, texto]) => `<option value="${valor}" ${actual === valor ? 'selected' : ''}>${texto}</option>`).join('');

    (function llenarSelectoresMes() {
        const [a, m] = hoy().split('-').map(Number);
        $('plMes').innerHTML = MESES_LARGOS
            .map((nombre, i) => `<option value="${String(i + 1).padStart(2, '0')}" ${i + 1 === m ? 'selected' : ''}>${nombre}</option>`)
            .join('');
        let anios = '';
        for (let x = 2025; x <= a + 1; x++) anios += `<option ${x === a ? 'selected' : ''}>${x}</option>`;
        $('plAnio').innerHTML = anios;
    })();

    async function cargarSeccionPlanilla() {
        await Promise.all([cargarPersonal(), cargarAjustes()]);
        abrirPlanilla();
    }

    $('planillaMesForm').addEventListener('submit', (e) => {
        e.preventDefault();
        abrirPlanilla();
    });

    async function abrirPlanilla() {
        const aviso = $('planillaMensaje');
        avisar(aviso, 'Cargando...');
        const { data, error } = await db
            .from('planillas')
            .select('*, lineas:planilla_lineas(*)')
            .eq('periodo', periodoElegido())
            .maybeSingle();
        if (error) {
            console.error('Error al cargar la planilla:', error);
            avisar(aviso, 'Error: ' + error.message, 'error');
            return;
        }
        avisar(aviso, '');
        planilla = data;
        if (planilla) planilla.lineas.sort(ordenarPorGrupo);
        pintarPlanilla();
    }

    function pintarPlanilla() {
        $('planillaVacia').hidden = !!planilla;
        $('planillaDetalle').hidden = !planilla;

        if (!planilla) {
            const activos = personal.filter(p => p.activo).length;
            $('planillaVaciaTexto').textContent = activos
                ? `No hay planilla de ${nombrePeriodo(periodoElegido())}. Se creará con las ${activos} personas activas del personal, con su sueldo, otros/viáticos e ISR de siempre.`
                : 'Primero agrega al personal del club en la sección "Personal" de abajo.';
            $('btnCrearPlanilla').hidden = !activos;
            $('btnCrearPlanilla').textContent = `Crear planilla de ${nombrePeriodo(periodoElegido())}`;
            return;
        }

        const editable = planilla.estado === 'borrador';
        $('planillaEstado').className = 'estado ' + planilla.estado;
        $('planillaEstado').textContent = editable ? 'Borrador' : 'Pagada';
        $('planillaEstadoTexto').textContent = editable
            ? 'Todavía se puede modificar. Al marcarla como pagada se registran los egresos en Movimientos.'
            : `Pagada el ${fechaCorta(planilla.fecha_pago)} por ${planilla.pagada_email}. Sus egresos ya están en Movimientos.`;
        $('planillaEdicion').hidden = !editable;
        $('planillaAyuda').hidden = !editable;
        $('btnRevertirPlanilla').hidden = editable;
        if (!$('plFechaPago').value) $('plFechaPago').value = hoy();

        const desactivado = editable ? '' : 'disabled';
        let filas = '';
        ORDEN_GRUPOS.forEach(grupo => {
            const lineas = planilla.lineas.filter(l => l.grupo === grupo);
            if (!lineas.length) return;
            filas += `<tr class="grupo"><td colspan="9">${GRUPOS[grupo]} (${lineas.length})</td>
                <td class="num" id="sub-${grupo}">${dinero(sumaCampo(lineas, 'neto'))}</td><td></td></tr>`;
            filas += lineas.map(l => `
                <tr data-linea="${l.id}">
                    <td>${escapar(l.nombre)}<small>${escapar(l.cargo)}</small></td>
                    ${CAMPOS_LINEA.map(c => `<td><input type="number" min="0" step="0.01" data-campo="${c}" value="${Number(l[c])}" ${desactivado}></td>`).join('')}
                    <td><select data-campo="forma_pago" ${desactivado}>${opcionesFormaPago(l.forma_pago)}</select></td>
                    <td><input type="text" class="p-nota" data-campo="nota" maxlength="200" value="${escapar(l.nota)}" ${desactivado}></td>
                    <td class="num"><strong data-neto>${dinero(l.neto)}</strong></td>
                    <td class="acciones">
                        <button type="button" class="btn-chico secundario" data-recibo>Recibo</button>
                        ${editable ? '<button type="button" class="btn-chico secundario" data-quitar>Quitar</button>' : ''}
                    </td>
                </tr>`).join('');
        });
        $('planillaLineas').innerHTML = filas || '<tr><td colspan="11" class="ayuda">La planilla no tiene personas. Agrégalas abajo.</td></tr>';
        pintarTotalesPlanilla();

        const incluidos = new Set(planilla.lineas.map(l => l.personal_id));
        const disponibles = personal.filter(p => p.activo && !incluidos.has(p.id));
        $('plAgregarPersona').innerHTML = disponibles.length
            ? disponibles.map(p => `<option value="${p.id}">${escapar(p.nombre)} · ${GRUPO_PERSONA[p.grupo]}</option>`).join('')
            : '<option value="">Todo el personal activo ya está incluido</option>';
        $('btnAgregarLinea').disabled = !disponibles.length;
    }

    function pintarTotalesPlanilla() {
        const l = planilla.lineas;
        $('planillaTotales').innerHTML = `
            <div><span>Total devengado</span><strong>${dinero(l.reduce((s, x) => s + devengado(x), 0))}</strong></div>
            <div><span>ISR retenido</span><strong class="egreso">−${dinero(sumaCampo(l, 'isr'))}</strong></div>
            <div><span>Otros descuentos</span><strong class="egreso">−${dinero(sumaCampo(l, 'descuentos'))}</strong></div>
            <div><span>Neto a pagar (${l.length} personas)</span><strong>${dinero(sumaCampo(l, 'neto'))}</strong></div>`;
        ORDEN_GRUPOS.forEach(grupo => {
            const celda = $('sub-' + grupo);
            if (celda) celda.textContent = dinero(sumaCampo(l.filter(x => x.grupo === grupo), 'neto'));
        });
    }

    $('btnCrearPlanilla').addEventListener('click', async (e) => {
        e.target.disabled = true;
        const { error } = await db.rpc('crear_planilla', { p_periodo: periodoElegido() });
        e.target.disabled = false;
        if (error) {
            avisar($('planillaMensaje'), 'Error: ' + error.message, 'error');
            return;
        }
        abrirPlanilla();
    });

    // Cada casilla se guarda al salir de ella.
    $('planillaLineas').addEventListener('change', async (e) => {
        const campo = e.target.dataset.campo;
        if (!campo) return;
        const fila = e.target.closest('tr');
        const linea = planilla.lineas.find(l => l.id === Number(fila.dataset.linea));
        const aviso = $('planillaMensaje');
        const esTexto = campo === 'nota' || campo === 'forma_pago';
        const restaurar = () => { e.target.value = esTexto ? (linea[campo] || '') : Number(linea[campo]); };

        let valor;
        if (esTexto) valor = e.target.value.trim() || null;
        else {
            valor = Number(e.target.value || 0);
            if (!(valor >= 0)) {
                restaurar();
                avisar(aviso, 'Los montos no pueden ser negativos.', 'error');
                return;
            }
        }

        const { data, error } = await db
            .from('planilla_lineas')
            .update({ [campo]: valor })
            .eq('id', linea.id)
            .select()
            .single();
        if (error) {
            restaurar();
            const texto = error.message.includes('neto_no_negativo')
                ? 'Las multas, el ISR y los descuentos no pueden ser mayores que lo devengado.'
                : error.message;
            avisar(aviso, 'Error: ' + texto, 'error');
            return;
        }
        Object.assign(linea, data);
        fila.querySelector('[data-neto]').textContent = dinero(linea.neto);
        pintarTotalesPlanilla();
        avisar(aviso, `Guardado: ${linea.nombre}.`, 'ok');
    });

    $('planillaLineas').addEventListener('click', async (e) => {
        const fila = e.target.closest('tr[data-linea]');
        if (!fila) return;
        const linea = planilla.lineas.find(l => l.id === Number(fila.dataset.linea));

        if ('recibo' in e.target.dataset) {
            imprimir(documentoRecibo(linea));
            return;
        }
        if (!('quitar' in e.target.dataset)) return;
        if (!confirm(`¿Quitar a ${linea.nombre} de esta planilla?`)) return;

        const { error } = await db.from('planilla_lineas').delete().eq('id', linea.id);
        if (error) {
            avisar($('planillaMensaje'), 'Error: ' + error.message, 'error');
            return;
        }
        abrirPlanilla();
    });

    $('btnAgregarLinea').addEventListener('click', async () => {
        const p = personal.find(x => x.id === Number($('plAgregarPersona').value));
        if (!p) return;
        const { error } = await db.from('planilla_lineas').insert([{
            planilla_id: planilla.id, personal_id: p.id, nombre: p.nombre, grupo: p.grupo, cargo: p.cargo,
            documento: p.documento, salario: p.salario, otros: p.otros, isr: p.isr, forma_pago: p.forma_pago
        }]);
        if (error) {
            avisar($('planillaMensaje'), 'Error: ' + error.message, 'error');
            return;
        }
        abrirPlanilla();
    });

    $('btnPagarPlanilla').addEventListener('click', async (e) => {
        const fechaPago = $('plFechaPago').value;
        if (!fechaPago) {
            avisar($('planillaMensaje'), 'Indica la fecha de pago.', 'error');
            return;
        }
        const total = sumaCampo(planilla.lineas, 'neto');
        if (!confirm(`¿Marcar la planilla de ${nombrePeriodo(planilla.periodo)} como pagada el ${fechaCorta(fechaPago)}?\n\n`
            + `Se registrarán egresos por ${dinero(total)} en Movimientos y la planilla ya no se podrá modificar `
            + '(salvo revirtiendo el pago).')) return;

        e.target.disabled = true;
        const { error } = await db.rpc('pagar_planilla', { p_id: planilla.id, p_fecha: fechaPago });
        e.target.disabled = false;
        if (error) {
            avisar($('planillaMensaje'), 'Error: ' + error.message, 'error');
            return;
        }
        await abrirPlanilla();
        avisar($('planillaMensaje'), 'Planilla pagada. Los egresos ya aparecen en Movimientos, el Dashboard y los Reportes.', 'ok');
    });

    $('btnRevertirPlanilla').addEventListener('click', async (e) => {
        const motivo = prompt('¿Por qué se revierte el pago? Sus egresos quedarán anulados en Movimientos y la planilla volverá a borrador.');
        if (motivo === null) return;
        e.target.disabled = true;
        const { error } = await db.rpc('revertir_planilla', { p_id: planilla.id, p_motivo: motivo });
        e.target.disabled = false;
        if (error) {
            avisar($('planillaMensaje'), 'Error: ' + error.message, 'error');
            return;
        }
        abrirPlanilla();
    });

    $('btnEliminarPlanilla').addEventListener('click', async () => {
        if (!confirm(`¿Eliminar el borrador de la planilla de ${nombrePeriodo(planilla.periodo)}? Se pierden los cambios cargados.`)) return;
        const { error } = await db.from('planillas').delete().eq('id', planilla.id);
        if (error) {
            avisar($('planillaMensaje'), 'Error: ' + error.message, 'error');
            return;
        }
        abrirPlanilla();
    });

    // Fecha que va en planilla y recibos: la del pago, o la elegida si todavía es borrador.
    const fechaDocumento = () => planilla.fecha_pago || $('plFechaPago').value || hoy();

    function documentoPlanilla() {
        const celdas = (l) => CAMPOS_LINEA.map(c => `<td class="num">${dinero(l[c])}</td>`).join('');
        const totales = (lineas) => CAMPOS_LINEA.map(c => `<td class="num">${dinero(sumaCampo(lineas, c))}</td>`).join('');
        let filas = '';
        ORDEN_GRUPOS.forEach(grupo => {
            const lineas = planilla.lineas.filter(l => l.grupo === grupo);
            if (!lineas.length) return;
            filas += `<tr class="grupo"><td colspan="9">${GRUPOS[grupo]}</td></tr>`;
            filas += lineas.map(l => `
                <tr><td>${escapar(l.nombre)}</td><td>${escapar(l.cargo)}</td>${celdas(l)}
                    <td class="num"><strong>${dinero(l.neto)}</strong></td></tr>`).join('');
            filas += `<tr class="total"><td colspan="2">Subtotal ${GRUPOS[grupo].toLowerCase()} (${lineas.length})</td>
                ${totales(lineas)}<td class="num">${dinero(sumaCampo(lineas, 'neto'))}</td></tr>`;
        });
        const l = planilla.lineas;
        const estado = planilla.estado === 'pagada' ? `Pagada el ${fechaCorta(planilla.fecha_pago)}` : 'BORRADOR — pendiente de pago';
        return `
            <div class="documento planilla-doc">
                ${membrete('Planilla de sueldos y bonos', `${mayuscula(nombrePeriodo(planilla.periodo))} · ${estado}`)}
                <table class="tabla">
                    <thead><tr><th>Nombre</th><th>Cargo</th><th class="num">Sueldo</th><th class="num">Bono</th>
                        <th class="num">Otros / viáticos</th><th class="num">Multas</th><th class="num">ISR</th>
                        <th class="num">Descuentos</th><th class="num">Neto</th></tr></thead>
                    <tbody>${filas}
                        <tr class="total neto-final"><td colspan="2">Total general (${l.length} personas)</td>
                            ${totales(l)}<td class="num">${dinero(sumaCampo(l, 'neto'))}</td></tr>
                    </tbody>
                </table>
                <div class="firmas"><div>Elaborado por</div>
                    <div>Autorizado por: ${escapar(ajustes.firmante_nombre || '')}<br>${escapar(ajustes.firmante_cargo || '')}</div></div>
                <p class="ayuda pie-reporte">Generado por ${escapar(perfil.nombre || perfil.email)} el ${new Date().toLocaleString('es')}</p>
            </div>`;
    }

    // Recibo individual con el formato que ya usa el club ("Cancelación de sueldo y bonos").
    function documentoRecibo(l) {
        const fila = (concepto, valor, clase) => `<tr class="${clase || ''}"><td>${concepto}</td><td class="num">${valor}</td></tr>`;
        const casilla = (forma) => `<span class="casilla">${l.forma_pago === forma ? '☒' : '☐'} ${FORMAS_PAGO[forma].toUpperCase()}</span>`;
        return `
            <div class="documento recibo">
                <div class="recibo-banda">
                    <img src="img/logo.jpg" alt="">
                    <strong>${CLUB.toUpperCase()}</strong>
                    <span>RECIBO<br>DE PAGO</span>
                </div>
                <h2>CANCELACIÓN DE SUELDO Y BONOS</h2>
                <p class="recibo-sub">Comprobante individual de pago · N.º ${planilla.periodo.slice(0, 7)}-${String(l.id).padStart(4, '0')}</p>

                <dl class="recibo-datos">
                    <dt>NOMBRE COMPLETO</dt><dd>${escapar(l.nombre)}</dd>
                    <dt>CARGO / POSICIÓN</dt><dd>${escapar(l.cargo || GRUPO_PERSONA[l.grupo])}</dd>
                    <dt>PERÍODO DE PAGO</dt><dd>${mayuscula(nombrePeriodo(planilla.periodo))}</dd>
                    <dt>FECHA DE PAGO</dt><dd>${fechaCorta(fechaDocumento()).replaceAll('/', ' / ')}</dd>
                </dl>

                <h3>DETALLE DEL PAGO</h3>
                <table class="recibo-tabla">
                    <thead><tr><th>CONCEPTO</th><th class="num">MONTO (US$)</th></tr></thead>
                    <tbody>
                        ${fila('Sueldo', dinero(l.salario))}
                        ${fila('Bono', dinero(l.bonos))}
                        ${fila('Otros / Bonificación adicional / Viáticos', dinero(l.otros))}
                        ${Number(l.multas) ? fila('Descuento por multa', '−' + dinero(l.multas)) : ''}
                        ${fila('TOTAL DEVENGADO', dinero(devengado(l)), 'resaltado')}
                        ${fila('Descuento ISR', dinero(l.isr))}
                        ${Number(l.descuentos) ? fila('Otros descuentos / adelantos', '−' + dinero(l.descuentos)) : ''}
                        ${fila('TOTAL NETO PAGADO', dinero(l.neto), 'resaltado')}
                    </tbody>
                </table>
                <p class="recibo-letras">TOTAL EN LETRAS: ${montoEnLetras(l.neto)}</p>
                ${l.nota ? `<p class="recibo-nota">Nota: ${escapar(l.nota)}</p>` : ''}

                <h3>FORMA DE PAGO</h3>
                <div class="recibo-formas">${Object.keys(FORMAS_PAGO).map(casilla).join('')}</div>

                <h3>CONSTANCIA DE PAGO</h3>
                <p class="recibo-constancia">Por medio del presente documento se deja constancia de que la persona identificada ha recibido
                    del ${CLUB} el monto neto indicado, correspondiente al sueldo y/o bonos del período señalado,
                    después de aplicar el descuento por ISR cuando corresponda.</p>

                <div class="recibo-firmas">
                    <div><span>FIRMA DE QUIEN RECIBE</span>${l.documento ? `<b>DUI: ${escapar(l.documento)}</b>` : ''}</div>
                    <div><span>FIRMA / ${escapar((ajustes.firmante_nombre || '').toUpperCase())}</span>
                        ${ajustes.firmante_dui ? `<b>DUI: ${escapar(ajustes.firmante_dui)}</b>` : ''}</div>
                </div>
                <p class="recibo-pie">${CLUB.toUpperCase()} • COMPROBANTE INTERNO DE PAGO</p>
            </div>`;
    }

    $('btnImprimirPlanilla').addEventListener('click', () => imprimir(documentoPlanilla()));
    $('btnRecibos').addEventListener('click', () => imprimir(planilla.lineas.map(documentoRecibo).join('')));

    $('btnExcelPlanilla').addEventListener('click', async () => {
        try {
            await cargarLibreriaExcel();
        } catch (error) {
            avisar($('planillaMensaje'), error.message, 'error');
            return;
        }
        const l = planilla.lineas;
        const filas = [
            [`${CLUB} — Planilla de sueldos y bonos`],
            [`${mayuscula(nombrePeriodo(planilla.periodo))} · ${planilla.estado === 'pagada' ? 'Pagada el ' + fechaCorta(planilla.fecha_pago) : 'Borrador'}`],
            [],
            ['Grupo', 'Nombre', 'Cargo', 'DUI', 'Sueldo', 'Bono', 'Otros / viáticos', 'Multas', 'Total devengado',
                'ISR', 'Descuentos', 'Neto', 'Forma de pago', 'Nota']
        ].concat(l.map(x => [
            GRUPOS[x.grupo], x.nombre, x.cargo || '', x.documento || '', Number(x.salario), Number(x.bonos), Number(x.otros),
            Number(x.multas), devengado(x), Number(x.isr), Number(x.descuentos), Number(x.neto), FORMAS_PAGO[x.forma_pago], x.nota || ''
        ]));
        filas.push(['Total', '', '', '', sumaCampo(l, 'salario'), sumaCampo(l, 'bonos'), sumaCampo(l, 'otros'),
            sumaCampo(l, 'multas'), l.reduce((s, x) => s + devengado(x), 0), sumaCampo(l, 'isr'),
            sumaCampo(l, 'descuentos'), sumaCampo(l, 'neto')]);

        const hoja = XLSX.utils.aoa_to_sheet(filas);
        hoja['!cols'] = [{ wch: 16 }, { wch: 38 }, { wch: 20 }, { wch: 18 }].concat(Array(8).fill({ wch: 13 }), [{ wch: 14 }, { wch: 40 }]);
        const libro = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(libro, hoja, 'Planilla');
        XLSX.writeFile(libro, `planilla_${planilla.periodo.slice(0, 7)}.xlsx`);
    });

    // ---- Pago de árbitros (todos los roles) ----
    const FUNCIONES_ARBITRO = ['Árbitro central', 'Asistente 1', 'Asistente 2', 'Cuarto árbitro', 'Comisario', 'Otro'];

    (function filasArbitros() {
        const fila = (funcion) => `
            <div class="arbitro">
                <input type="text" class="a-nombre" maxlength="120" placeholder="Nombre completo" aria-label="Nombre">
                <select class="a-funcion" aria-label="Función">${FUNCIONES_ARBITRO
                    .map(f => `<option ${f === funcion ? 'selected' : ''}>${f}</option>`).join('')}</select>
                <input type="text" class="a-dui" maxlength="40" placeholder="DUI" aria-label="DUI">
                <input type="number" class="a-monto" min="0" step="0.01" placeholder="$0.00" aria-label="Monto">
            </div>`;
        $('arbitros').innerHTML = '<div class="arbitro arbitros-titulos"><span>Nombre</span><span>Función</span><span>DUI</span><span>Monto</span></div>'
            + FUNCIONES_ARBITRO.slice(0, 4).map(fila).join('');
    })();

    function arbitrosDelFormulario() {
        return Array.from(document.querySelectorAll('#arbitros .arbitro:not(.arbitros-titulos)'))
            .map(f => ({
                nombre: f.querySelector('.a-nombre').value.trim(),
                funcion: f.querySelector('.a-funcion').value,
                documento: f.querySelector('.a-dui').value.trim(),
                monto: Number(f.querySelector('.a-monto').value || 0)
            }))
            .filter(a => a.nombre || a.monto);
    }

    $('arbitros').addEventListener('input', () => {
        const total = arbitrosDelFormulario().reduce((s, a) => s + a.monto, 0);
        $('arbTotal').textContent = total ? `Total: ${dinero(total)}` : '';
        $('monto').value = total.toFixed(2);
    });

    // "Registrar Movimiento" con la opción de detallar árbitros: el egreso, sus árbitros
    // y los comprobantes adjuntos se registran juntos, y luego se imprimen los recibos.
    async function registrarArbitraje() {
        const arbitros = arbitrosDelFormulario();
        const archivos = Array.from($('archivos').files);
        if (!$('concepto').value.trim()) {
            avisar(mensaje, 'Escribe el concepto.', 'error');
            return;
        }
        if (!arbitros.length || arbitros.some(a => !a.nombre || !(a.monto > 0))) {
            avisar(mensaje, 'Cada árbitro necesita su nombre y un monto mayor a 0.', 'error');
            return;
        }
        const problema = revisarArchivos(archivos);
        if (problema) {
            avisar(mensaje, problema, 'error');
            return;
        }

        $('btnGuardar').disabled = true;
        avisar(mensaje, 'Registrando...');
        const { data: transaccionId, error } = await db.rpc('registrar_pago_arbitraje', {
            p_fecha: fecha.value,
            p_concepto: $('concepto').value,
            p_proveedor: $('proveedor').value,
            p_num_documento: $('numDocumento').value,
            p_partido: $('arbPartido').value,
            p_competicion: $('arbCompeticion').value,
            p_forma_pago: $('arbForma').value,
            p_arbitros: arbitros
        });
        if (error) {
            $('btnGuardar').disabled = false;
            avisar(mensaje, 'Error: ' + error.message, 'error');
            return;
        }

        let texto = 'Pago registrado. Imprime los recibos y hazlos firmar.';
        if (archivos.length) {
            avisar(mensaje, 'Subiendo comprobantes...');
            const fallidos = await subirComprobantes(transaccionId, archivos);
            if (fallidos.length) texto = `Pago registrado, pero no se pudieron subir: ${fallidos.join(', ')}. Usa "Adjuntar" en el historial.`;
        }
        $('btnGuardar').disabled = false;
        avisar(mensaje, texto, texto.startsWith('Pago registrado.') ? 'ok' : 'error');
        $('arbTotal').textContent = '';
        limpiarFormulario();
        cargarHistorial();
        imprimirRecibosArbitraje(transaccionId);
    }

    async function imprimirRecibosArbitraje(transaccionId) {
        const { data, error } = await db
            .from('arbitrajes')
            .select('id, partido, competicion, forma_pago, transaccion:transacciones(fecha), lineas:arbitraje_lineas(id, nombre, funcion, documento, monto)')
            .eq('transaccion_id', transaccionId)
            .single();
        if (error) {
            avisar(historialMensaje, 'No se pudieron cargar los recibos: ' + error.message, 'error');
            return;
        }
        data.lineas.sort((a, b) => FUNCIONES_ARBITRO.indexOf(a.funcion) - FUNCIONES_ARBITRO.indexOf(b.funcion));
        imprimir(data.lineas.map((l, i) => documentoReciboArbitraje(data, l, i + 1)).join(''));
    }

    function documentoReciboArbitraje(arb, l, numero) {
        const casilla = (forma) => `<span class="casilla">${arb.forma_pago === forma ? '☒' : '☐'} ${FORMAS_PAGO[forma].toUpperCase()}</span>`;
        return `
            <div class="documento recibo">
                <div class="recibo-banda">
                    <img src="img/logo.jpg" alt="">
                    <strong>${CLUB.toUpperCase()}</strong>
                    <span>RECIBO<br>DE PAGO</span>
                </div>
                <h2>PAGO DE ARBITRAJE</h2>
                <p class="recibo-sub">Comprobante individual de pago · N.º ARB-${String(arb.id).padStart(4, '0')}-${numero}</p>

                <dl class="recibo-datos">
                    <dt>NOMBRE COMPLETO</dt><dd>${escapar(l.nombre)}</dd>
                    <dt>FUNCIÓN</dt><dd>${escapar(l.funcion)}</dd>
                    <dt>PARTIDO</dt><dd>${escapar(arb.partido)}</dd>
                    ${arb.competicion ? `<dt>COMPETICIÓN / JORNADA</dt><dd>${escapar(arb.competicion)}</dd>` : ''}
                    <dt>FECHA</dt><dd>${fechaCorta(arb.transaccion.fecha).replaceAll('/', ' / ')}</dd>
                </dl>

                <h3>DETALLE DEL PAGO</h3>
                <table class="recibo-tabla">
                    <thead><tr><th>CONCEPTO</th><th class="num">MONTO (US$)</th></tr></thead>
                    <tbody>
                        <tr><td>Honorarios de arbitraje — ${escapar(l.funcion)}</td><td class="num">${dinero(l.monto)}</td></tr>
                        <tr class="resaltado"><td>TOTAL PAGADO</td><td class="num">${dinero(l.monto)}</td></tr>
                    </tbody>
                </table>
                <p class="recibo-letras">TOTAL EN LETRAS: ${montoEnLetras(l.monto)}</p>

                <h3>FORMA DE PAGO</h3>
                <div class="recibo-formas">${Object.keys(FORMAS_PAGO).map(casilla).join('')}</div>

                <h3>CONSTANCIA DE PAGO</h3>
                <p class="recibo-constancia">Por medio del presente documento se deja constancia de que la persona identificada ha recibido
                    del ${CLUB} el monto indicado, en concepto de honorarios de arbitraje por el partido señalado.</p>

                <div class="recibo-firmas">
                    <div><span>FIRMA DE QUIEN RECIBE</span><b>DUI: ${escapar(l.documento || '______________')}</b></div>
                    <div><span>ENTREGADO POR (${CLUB.toUpperCase()})</span><b>Nombre: ______________________</b></div>
                </div>
                <p class="recibo-pie">${CLUB.toUpperCase()} • COMPROBANTE INTERNO DE PAGO</p>
            </div>`;
    }

    // ---- Inventario (camisetas y otra mercadería) ----
    // Todos venden; el dueño y el gerente crean productos y registran entradas y salidas.
    // La existencia la calcula la base de datos: entradas menos ventas y salidas, sin contar ventas anuladas.
    let productos = [];
    const TIPOS_INVENTARIO = { entrada: 'Entrada', venta: 'Venta', salida: 'Salida' };
    const nombreProducto = (p) => [p.nombre, p.color, p.talla && `talla ${p.talla}`].filter(Boolean).join(' · ');

    async function cargarInventario() {
        $('vFecha').value = $('vFecha').value || hoy();
        $('esFecha').value = $('esFecha').value || hoy();
        $('tituloInvMovimientos').textContent = puede('secretaria') ? 'Mis ventas registradas' : 'Movimientos de inventario';
        const { data, error } = await db.rpc('existencias');
        if (error) {
            avisar($('existenciasMensaje'), 'Error: ' + error.message, 'error');
            return;
        }
        productos = data;
        pintarVenta();
        pintarExistencias();
        cargarMovimientosInventario();
    }

    function pintarVenta() {
        const disponibles = productos.filter(p => p.activo && p.existencia > 0);
        $('ventaProductos').innerHTML = disponibles.length
            ? disponibles.map(p => `
                <label class="venta-item" data-producto="${p.id}" data-precio="${p.precio}">
                    <span>${escapar(nombreProducto(p))} <small class="detalle">${dinero(p.precio)} · quedan ${p.existencia}</small></span>
                    <input type="number" class="v-cantidad" min="0" max="${p.existencia}" step="1" placeholder="0" aria-label="Cantidad">
                </label>`).join('')
            : '<p class="ayuda">No hay productos con existencia. El dueño o el gerente deben registrar una entrada primero.</p>';
        $('btnVenta').disabled = !disponibles.length;
        $('ventaTotal').textContent = '';
    }

    function itemsVenta() {
        return Array.from(document.querySelectorAll('#ventaProductos .venta-item'))
            .map(f => ({
                producto_id: Number(f.dataset.producto),
                precio: Number(f.dataset.precio),
                cantidad: Number(f.querySelector('.v-cantidad').value || 0)
            }))
            .filter(i => i.cantidad > 0);
    }

    $('ventaProductos').addEventListener('input', () => {
        const total = itemsVenta().reduce((s, i) => s + i.cantidad * i.precio, 0);
        $('ventaTotal').textContent = total ? `Total: ${dinero(total)}` : '';
    });

    $('ventaForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const aviso = $('ventaMensaje');
        const items = itemsVenta();
        if (!items.length || items.some(i => !Number.isInteger(i.cantidad))) {
            avisar(aviso, 'Escribe cuántas unidades se vendieron (números enteros).', 'error');
            return;
        }
        const ventana = window.open('', '_blank'); // se abre ya, si no el navegador la bloquea
        $('btnVenta').disabled = true;
        avisar(aviso, 'Registrando...');
        const fecha = $('vFecha').value;
        const { data: ids, error } = await db.rpc('registrar_venta', {
            p_fecha: fecha,
            p_items: items.map(({ producto_id, cantidad }) => ({ producto_id, cantidad }))
        });
        if (error) {
            $('btnVenta').disabled = false;
            if (ventana) ventana.close();
            avisar(aviso, 'Error: ' + error.message, 'error');
            return;
        }
        const total = items.reduce((s, i) => s + i.cantidad * i.precio, 0);
        const lineas = items.map(i => ({ ...i, producto: productos.find(p => p.id === i.producto_id) }));

        // El ticket queda adjunto al ingreso (o a cada ingreso, si la venta tocó varias categorías).
        let resultado = `Venta de ${dinero(total)} registrada.`;
        let problema = false;
        try {
            avisar(aviso, 'Generando el ticket...');
            const pdf = await ticketVenta(ids, fecha, lineas, total);
            const archivo = new File([pdf], `ticket-venta-${ids[0]}.pdf`, { type: 'application/pdf' });
            const fallidos = (await Promise.all(ids.map(id => subirComprobantes(id, [archivo])))).flat();
            if (fallidos.length) {
                problema = true;
                resultado += ' El ticket no se pudo adjuntar al ingreso; descárgalo y agrégalo desde Movimientos.';
            }
            const enlace = URL.createObjectURL(pdf);
            if (ventana) ventana.location = enlace;
            else location.href = enlace;
        } catch (err) {
            if (ventana) ventana.close();
            console.error('Error al generar el ticket:', err);
            problema = true;
            resultado += ' No se pudo generar el ticket: ' + err.message;
        }
        $('btnVenta').disabled = false;
        avisar(aviso, resultado, problema ? 'error' : 'ok');
        await cargarInventario();
    });

    // La librería de PDF solo se descarga la primera vez que se hace un ticket.
    function cargarLibreriaPdf() {
        if (window.jspdf) return Promise.resolve();
        return new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
            s.onload = resolve;
            s.onerror = () => reject(new Error('No se pudo descargar la librería de PDF. Revisa tu conexión.'));
            document.head.appendChild(s);
        });
    }

    function cargarImagen(src) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error('No se pudo cargar el escudo'));
            img.src = src;
        });
    }

    // Ticket en hoja carta (papel bond): arriba el original para el cliente y abajo la copia del club,
    // con una línea para cortar por la mitad. Si la venta tiene muchos productos, cada copia va en su hoja.
    async function ticketVenta(ids, fecha, lineas, total) {
        await cargarLibreriaPdf();
        const doc = new window.jspdf.jsPDF({ unit: 'mm', format: 'letter' });
        const ANCHO = 215.9, MITAD = 139.7, X = 15, DERECHA = ANCHO - 15;
        let escudo = null;
        try {
            escudo = await cargarImagen('img/logo.jpg');
        } catch (_) {
            // sin escudo el ticket sigue siendo válido
        }
        const hora = new Date().toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
        const raya = (y) => { doc.setLineDashPattern([], 0); doc.setDrawColor(150); doc.line(X, y, DERECHA, y); };

        function copia(y0, leyenda) {
            let y = y0 + 12;
            if (escudo) doc.addImage(escudo, 'JPEG', X, y, 20, 20);
            const xTexto = escudo ? X + 24 : X;
            doc.setTextColor(0);
            doc.setFont('helvetica', 'bold').setFontSize(13);
            doc.text(CLUB, xTexto, y + 7);
            doc.setFont('helvetica', 'normal').setFontSize(9);
            doc.text('La Unión, El Salvador', xTexto, y + 12);
            doc.setFont('helvetica', 'bold').setFontSize(11);
            doc.text('TICKET DE VENTA', DERECHA, y + 5, { align: 'right' });
            doc.text(`N.º ${ids.join(', ')}`, DERECHA, y + 10.5, { align: 'right' });
            doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(110);
            doc.text(leyenda, DERECHA, y + 15.5, { align: 'right' });
            doc.setTextColor(0).setFontSize(9);
            y += 26;
            doc.text(`Fecha: ${fechaCorta(fecha)}   ${hora}`, X, y);
            doc.text(`Atendió: ${perfil.nombre || perfil.email}`, DERECHA, y, { align: 'right' });

            raya(y += 4);
            doc.setFont('helvetica', 'bold');
            doc.text('Cant.', X + 2, y += 5);
            doc.text('Producto', X + 20, y);
            doc.text('Precio', DERECHA - 35, y, { align: 'right' });
            doc.text('Importe', DERECHA - 2, y, { align: 'right' });
            raya(y += 2.5);
            doc.setFont('helvetica', 'normal');
            for (const l of lineas) {
                doc.text(String(l.cantidad), X + 2, y += 5.5);
                doc.text(doc.splitTextToSize(nombreProducto(l.producto), 105)[0], X + 20, y);
                doc.text(dinero(l.precio), DERECHA - 35, y, { align: 'right' });
                doc.text(dinero(l.cantidad * l.precio), DERECHA - 2, y, { align: 'right' });
            }
            raya(y += 3);

            doc.setFont('helvetica', 'bold').setFontSize(12);
            doc.text('TOTAL', DERECHA - 35, y += 7, { align: 'right' });
            doc.text(dinero(total), DERECHA - 2, y, { align: 'right' });
            doc.setFont('helvetica', 'normal').setFontSize(8);
            doc.text(montoEnLetras(total), X, y);

            const pie = Math.max(y + 12, y0 + MITAD - 14);
            doc.setFontSize(9);
            doc.text('¡Gracias por apoyar al club!', ANCHO / 2, pie, { align: 'center' });
            doc.setFontSize(7).setTextColor(110);
            doc.text('Comprobante interno de venta, no es factura.', ANCHO / 2, pie + 4, { align: 'center' });
            doc.setTextColor(0);
        }

        // Encabezado (~50 mm) + filas + total y pie (~35 mm) deben caber en media hoja.
        const cabenEnMedia = 50 + lineas.length * 5.5 + 35 <= MITAD;
        copia(0, 'ORIGINAL · CLIENTE');
        if (cabenEnMedia) {
            doc.setLineDashPattern([2, 2], 0).setDrawColor(150);
            doc.line(5, MITAD, ANCHO - 5, MITAD);
            doc.setFontSize(7).setTextColor(130);
            doc.text('cortar aquí', ANCHO / 2, MITAD - 1.5, { align: 'center' });
            copia(MITAD, 'COPIA · CLUB');
        } else {
            doc.addPage('letter');
            copia(0, 'COPIA · CLUB');
        }
        return doc.output('blob');
    }

    function pintarExistencias() {
        const gestion = puede('dueno', 'gerente');
        const activos = productos.filter(p => p.activo);
        const unidades = activos.reduce((s, p) => s + p.existencia, 0);
        $('inventarioTotales').innerHTML = `
            <div><span>Unidades en existencia</span><strong>${unidades}</strong></div>
            <div><span>Valor a precio de venta</span><strong>${dinero(activos.reduce((s, p) => s + p.existencia * p.precio, 0))}</strong></div>
            <div><span>Productos activos</span><strong>${activos.length}</strong></div>`;

        const categoriasIngreso = categorias.filter(c => c.tipo === 'ingreso' && c.activa);
        const opcionesCategoria = (actual) => categoriasIngreso
            .map(c => `<option value="${c.id}" ${c.id === actual ? 'selected' : ''}>${escapar(c.nombre)}</option>`).join('');
        $('prCategoria').innerHTML = opcionesCategoria((categorias.find(c => c.clave === 'venta_camisetas') || {}).id);
        $('esProducto').innerHTML = productos.filter(p => p.activo)
            .map(p => `<option value="${p.id}">${escapar(nombreProducto(p))} (quedan ${p.existencia})</option>`).join('');

        $('existencias').innerHTML = productos.length
            ? productos.map(p => gestion ? `
                <tr data-producto="${p.id}" class="${p.activo ? '' : 'anulada'}">
                    <td><input type="text" class="pr-nombre" value="${escapar(p.nombre)}" maxlength="80"></td>
                    <td><input type="text" class="pr-color" value="${escapar(p.color)}" maxlength="40"></td>
                    <td><input type="text" class="pr-talla" value="${escapar(p.talla)}" maxlength="20"></td>
                    <td><input type="number" class="pr-precio" value="${Number(p.precio)}" min="0.01" step="0.01"></td>
                    <td class="num"><strong>${p.existencia}</strong></td>
                    <td><select class="pr-categoria">${opcionesCategoria(p.categoria_id)}</select></td>
                    <td><input type="checkbox" class="pr-activo" ${p.activo ? 'checked' : ''}></td>
                    <td><button type="button" class="btn-chico" data-guardar>Guardar</button></td>
                </tr>` : `
                <tr class="${p.activo ? '' : 'anulada'}">
                    <td>${escapar(p.nombre)}</td><td>${escapar(p.color)}</td><td>${escapar(p.talla)}</td>
                    <td class="num">${dinero(p.precio)}</td><td class="num"><strong>${p.existencia}</strong></td>
                </tr>`).join('')
            : `<tr><td colspan="8" class="ayuda">Todavía no hay productos.${gestion ? ' Agrégalos con el formulario de arriba.' : ''}</td></tr>`;
    }

    $('productoForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const nuevo = {
            nombre: $('prNombre').value.trim(),
            color: $('prColor').value.trim() || null,
            talla: $('prTalla').value.trim() || null,
            precio: Number($('prPrecio').value),
            categoria_id: Number($('prCategoria').value)
        };
        const existencia = Number($('prExistencia').value || 0);
        if (!Number.isInteger(existencia) || existencia < 0) {
            avisar($('existenciasMensaje'), 'La existencia inicial debe ser un número entero (0 o más).', 'error');
            return;
        }
        // La existencia inicial queda como una entrada en el historial, igual que un pedido.
        const { error } = await db.rpc('crear_producto', {
            p_nombre: nuevo.nombre,
            p_color: nuevo.color,
            p_talla: nuevo.talla,
            p_precio: nuevo.precio,
            p_categoria: nuevo.categoria_id,
            p_existencia: existencia,
            p_fecha: hoy()
        });
        if (error) {
            avisar($('existenciasMensaje'), 'Error: ' + error.message, 'error');
            return;
        }
        avisar($('existenciasMensaje'), existencia
            ? `${nombreProducto(nuevo)} agregado con ${existencia} en existencia.`
            : `${nombreProducto(nuevo)} agregado. Registra su existencia con una entrada.`, 'ok');
        $('productoForm').reset();
        $('prNombre').focus();
        await cargarInventario();
    });

    $('existencias').addEventListener('click', async (e) => {
        if (!('guardar' in e.target.dataset)) return;
        const fila = e.target.closest('tr');
        const valor = (clase) => fila.querySelector('.' + clase).value.trim();
        const cambios = {
            nombre: valor('pr-nombre'),
            color: valor('pr-color') || null,
            talla: valor('pr-talla') || null,
            precio: Number(valor('pr-precio')),
            categoria_id: Number(valor('pr-categoria')),
            activo: fila.querySelector('.pr-activo').checked
        };
        e.target.disabled = true;
        const { error } = await db.from('productos').update(cambios).eq('id', Number(fila.dataset.producto));
        e.target.disabled = false;
        if (error) {
            avisar($('existenciasMensaje'), 'Error: ' + error.message, 'error');
            return;
        }
        avisar($('existenciasMensaje'), `${nombreProducto(cambios)} actualizado.`, 'ok');
        await cargarInventario();
    });

    $('entradaSalidaForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const aviso = $('entradaSalidaMensaje');
        const cantidad = Number($('esCantidad').value);
        if (!Number.isInteger(cantidad) || cantidad <= 0) {
            avisar(aviso, 'La cantidad debe ser un número entero mayor a 0.', 'error');
            return;
        }
        if ($('esTipo').value === 'salida' && $('esNota').value.trim().length < 3) {
            avisar(aviso, 'Escribe el motivo de la salida en la nota.', 'error');
            return;
        }
        $('btnEntradaSalida').disabled = true;
        const { error } = await db.rpc('movimiento_inventario', {
            p_producto: Number($('esProducto').value),
            p_tipo: $('esTipo').value,
            p_cantidad: cantidad,
            p_fecha: $('esFecha').value,
            p_nota: $('esNota').value
        });
        $('btnEntradaSalida').disabled = false;
        if (error) {
            avisar(aviso, 'Error: ' + error.message, 'error');
            return;
        }
        avisar(aviso, `${TIPOS_INVENTARIO[$('esTipo').value]} de ${cantidad} registrada.`, 'ok');
        $('esCantidad').value = '';
        $('esNota').value = '';
        await cargarInventario();
    });

    async function cargarMovimientosInventario() {
        const { data, error } = await db
            .from('inventario_movimientos')
            .select('id, producto_id, fecha, tipo, cantidad, precio, nota, registrado_email, transaccion:transacciones(anulada)')
            .order('fecha', { ascending: false })
            .order('id', { ascending: false })
            .limit(100);
        if (error) {
            $('invMovimientos').innerHTML = `<tr><td colspan="6" class="ayuda">Error: ${escapar(error.message)}</td></tr>`;
            return;
        }
        $('invMovimientos').innerHTML = data.length
            ? data.map(m => {
                const p = productos.find(x => x.id === m.producto_id) || { nombre: '—' };
                const anulada = m.transaccion && m.transaccion.anulada;
                const detalle = m.tipo === 'venta'
                    ? `${dinero(m.cantidad * m.precio)}${anulada ? ' · ingreso anulado, no cuenta' : ''}`
                    : escapar(m.nota || '');
                return `
                    <tr class="${anulada ? 'anulada' : ''}">
                        <td>${fechaCorta(m.fecha)}</td>
                        <td>${escapar(nombreProducto(p))}</td>
                        <td>${TIPOS_INVENTARIO[m.tipo]}</td>
                        <td class="num">${m.tipo === 'entrada' ? '+' : '−'}${m.cantidad}</td>
                        <td>${detalle}</td>
                        <td>${escapar(m.registrado_email || '')}</td>
                    </tr>`;
            }).join('')
            : '<tr><td colspan="6" class="ayuda">Todavía no hay movimientos.</td></tr>';
    }

    // ---- Boletería (partidos de local) ----
    // El dueño y el gerente crean partidos e imprimen talonarios; cualquiera de los tres liquida la taquilla.
    // Los códigos de las entradas no se pueden leer de la tabla: solo salen al imprimir un talonario.
    let partidos = [];
    let partidoActual = null;  // fila de partidos_boleteria
    let localidadesPartido = []; // filas de resumen_partido
    const LOCALIDADES_BASE = [{ nombre: 'General', precio: 7 }, { nombre: 'Tribuna poniente', precio: 12 }];
    const horaCorta = (h) => (h ? h.slice(0, 5) : '');

    function filaLocalidad(l = {}) {
        const fila = document.createElement('div');
        fila.className = 'localidad-fila';
        fila.innerHTML = `
            <input type="text" class="l-nombre" maxlength="40" value="${escapar(l.nombre || '')}" aria-label="Localidad" required>
            <input type="number" class="l-precio" min="0.01" step="0.01" value="${l.precio || ''}" aria-label="Precio" required>
            <input type="number" class="l-cupo" min="1" step="1" aria-label="Cupo">
            <button type="button" class="btn-chico secundario" data-quitar>Quitar</button>`;
        $('paLocalidades').appendChild(fila);
    }

    function reiniciarPartidoForm() {
        $('partidoForm').reset();
        $('paLocalidades').innerHTML = '';
        LOCALIDADES_BASE.forEach(filaLocalidad);
    }
    reiniciarPartidoForm();

    $('btnAgregarLocalidad').addEventListener('click', () => filaLocalidad());
    $('paLocalidades').addEventListener('click', (e) => {
        if ('quitar' in e.target.dataset && $('paLocalidades').children.length > 1) e.target.closest('.localidad-fila').remove();
    });

    $('partidoForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const aviso = $('partidoMensaje');
        const localidades = Array.from($('paLocalidades').children).map(f => ({
            nombre: f.querySelector('.l-nombre').value.trim(),
            precio: Number(f.querySelector('.l-precio').value),
            cupo: f.querySelector('.l-cupo').value || null
        }));
        $('btnCrearPartido').disabled = true;
        const { data: id, error } = await db.rpc('crear_partido', {
            p_fecha: $('paFecha').value,
            p_hora: $('paHora').value || null,
            p_rival: $('paRival').value,
            p_torneo: $('paTorneo').value,
            p_localidades: localidades
        });
        $('btnCrearPartido').disabled = false;
        if (error) {
            avisar(aviso, 'Error: ' + (error.code === '23505' ? 'hay dos localidades con el mismo nombre.' : error.message), 'error');
            return;
        }
        avisar(aviso, 'Partido creado. Ahora imprime los talonarios de cada localidad.', 'ok');
        reiniciarPartidoForm();
        await cargarBoleteria();
        abrirPartido(id);
    });

    // ---- Equipos rivales (escudos para talonarios y página de compra) ----
    let equipos = [];
    let equipoEditando = null;
    const urlEscudo = (ruta) => db.storage.from('escudos').getPublicUrl(ruta).data.publicUrl;

    async function cargarEquipos() {
        const { data, error } = await db.from('equipos').select('id, nombre, escudo').order('nombre');
        if (error) {
            avisar($('equipoMensaje'), 'Error: ' + error.message, 'error');
            return;
        }
        equipos = data;
        $('listaEquipos').innerHTML = equipos.map(e => `<option value="${escapar(e.nombre)}">`).join('');
        $('equipos').innerHTML = equipos.length ? equipos.map(e => `
            <div class="equipo">
                ${e.escudo ? `<img src="${escapar(urlEscudo(e.escudo))}" alt="">` : '<span class="sin-escudo">Sin escudo</span>'}
                <span>${escapar(e.nombre)}</span>
                <button type="button" class="btn-chico secundario" data-editar-equipo="${e.id}">Editar</button>
            </div>`).join('')
            : '<p class="ayuda">Todavía no hay equipos. Agrega los rivales de la liga con su escudo.</p>';
    }

    // El escudo se guarda en PNG de máximo 400 px: pesa poco y conserva el fondo transparente.
    async function prepararEscudo(archivo) {
        const imagen = await createImageBitmap(archivo);
        const escala = Math.min(1, 400 / Math.max(imagen.width, imagen.height));
        const lienzo = document.createElement('canvas');
        lienzo.width = Math.round(imagen.width * escala);
        lienzo.height = Math.round(imagen.height * escala);
        lienzo.getContext('2d').drawImage(imagen, 0, 0, lienzo.width, lienzo.height);
        return new Promise(listo => lienzo.toBlob(listo, 'image/png'));
    }

    function reiniciarEquipoForm() {
        equipoEditando = null;
        $('equipoForm').reset();
        $('btnEquipo').textContent = 'Guardar equipo';
        $('btnEquipoCancelar').hidden = true;
    }

    $('equipos').addEventListener('click', (e) => {
        const id = Number(e.target.dataset.editarEquipo);
        const equipo = equipos.find(x => x.id === id);
        if (!equipo) return;
        equipoEditando = id;
        $('eqNombre').value = equipo.nombre;
        $('btnEquipo').textContent = 'Guardar cambios';
        $('btnEquipoCancelar').hidden = false;
        $('eqNombre').focus();
    });
    $('btnEquipoCancelar').addEventListener('click', reiniciarEquipoForm);

    $('equipoForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const aviso = $('equipoMensaje');
        const archivo = $('eqEscudo').files[0];
        $('btnEquipo').disabled = true;
        let ruta = null;
        if (archivo) {
            let png;
            try {
                png = await prepararEscudo(archivo);
            } catch (_) {
                png = null;
            }
            if (!png) {
                $('btnEquipo').disabled = false;
                avisar(aviso, 'No se pudo leer la imagen. Prueba con un PNG o JPG.', 'error');
                return;
            }
            ruta = `${crypto.randomUUID()}.png`;
            const subida = await db.storage.from('escudos').upload(ruta, png, { contentType: 'image/png' });
            if (subida.error) {
                $('btnEquipo').disabled = false;
                avisar(aviso, 'No se pudo subir el escudo: ' + subida.error.message, 'error');
                return;
            }
        }
        const { error } = await db.rpc('guardar_equipo', { p_id: equipoEditando, p_nombre: $('eqNombre').value, p_escudo: ruta });
        $('btnEquipo').disabled = false;
        if (error) {
            avisar(aviso, 'Error: ' + error.message, 'error');
            return;
        }
        avisar(aviso, 'Equipo guardado.', 'ok');
        reiniciarEquipoForm();
        await cargarEquipos();
    });

    // Escudo del rival de un partido, listo para el PDF (o null si no tiene o no se puede usar).
    async function escudoRival(partidoId) {
        const { data } = await db.from('partidos').select('equipos(escudo)').eq('id', partidoId).maybeSingle();
        const ruta = data?.equipos?.escudo;
        return ruta ? pngParaPdf(urlEscudo(ruta)) : null;
    }

    // Se le pasan al PDF los bytes del PNG tal cual: así no depende de cómo el navegador redibuja la imagen.
    async function pngParaPdf(url) {
        try {
            const respuesta = await fetch(url);
            if (!respuesta.ok) return null;
            const blob = await respuesta.blob();
            const bytes = new Uint8Array(await blob.arrayBuffer());
            const img = await cargarImagen(URL.createObjectURL(blob));
            // prueba en un PDF aparte: si el PNG no le sirve a la librería, el talonario sale sin él
            new window.jspdf.jsPDF().addImage(bytes, 'PNG', 0, 0, 10, 10);
            return { bytes, ancho: img.naturalWidth, alto: img.naturalHeight };
        } catch (err) {
            console.warn('Una imagen no se pudo usar en el PDF:', url, err);
            return null;
        }
    }

    async function cargarBoleteria() {
        $('liqFecha').value = $('liqFecha').value || hoy();
        cargarEquipos();
        const { data, error } = await db.rpc('partidos_boleteria');
        if (error) {
            avisar($('partidosMensaje'), 'Error: ' + error.message, 'error');
            return;
        }
        partidos = data;
        pintarPartidos();
        if (partidoActual) await abrirPartido(partidoActual.id);
    }

    function estadoPartido(p) {
        if (p.cancelado) return ['Cancelado', 'cancelado'];
        if (p.liquidado) return ['Liquidado', 'pagada'];
        if (p.fecha > hoy()) return ['Próximo', 'borrador'];
        if (p.fecha === hoy()) return ['Hoy', 'hoy'];
        return ['Por liquidar', 'borrador'];
    }

    function pintarPartidos() {
        $('partidos').innerHTML = partidos.length ? partidos.map(p => {
            const [texto, clase] = estadoPartido(p);
            return `
                <tr>
                    <td>${fechaCorta(p.fecha)} <small class="detalle">${horaCorta(p.hora)}</small></td>
                    <td>${escapar(p.rival)}${p.torneo ? `<small class="detalle">${escapar(p.torneo)}</small>` : ''}</td>
                    <td class="num">${p.impresas}</td>
                    <td class="num">${p.escaneadas}</td>
                    <td class="num">${p.liquidado ? dinero(p.recaudado) : '—'}</td>
                    <td><span class="estado ${clase}">${texto}</span></td>
                    <td><button type="button" class="btn-chico" data-abrir="${p.id}">Abrir</button></td>
                </tr>`;
        }).join('') : '<tr><td colspan="7">Todavía no hay partidos.</td></tr>';
    }

    $('partidos').addEventListener('click', (e) => {
        if (e.target.dataset.abrir) abrirPartido(Number(e.target.dataset.abrir));
    });

    async function abrirPartido(id) {
        partidoActual = partidos.find(p => p.id === id) || null;
        if (!partidoActual) {
            $('partidoDetalle').hidden = true;
            return;
        }
        const resumen = await db.rpc('resumen_partido', { p_partido_id: id });
        const lotes = resumen.error ? {} : await db.from('talonarios')
            .select('id, localidad_id, desde, hasta, created_at, creado_email')
            .in('localidad_id', resumen.data.map(l => l.localidad_id))
            .order('created_at', { ascending: false });
        if (resumen.error || lotes.error) {
            avisar($('partidosMensaje'), 'Error: ' + (resumen.error || lotes.error).message, 'error');
            return;
        }
        localidadesPartido = resumen.data;
        pintarDetallePartido(lotes.data);
        boletosPartido = null;
        $('boletosBloque').hidden = true;
        $('btnBoletos').textContent = 'Ver boletos';
        $('btnBoletos').setAttribute('aria-expanded', 'false');
        $('partidoDetalle').hidden = false;
    }

    // Boleto por boleto: si entró, a qué hora y quién lo escaneó (sin el código, para que no se pueda copiar)
    let boletosPartido = null;
    $('btnBoletos').addEventListener('click', async () => {
        const abrir = $('boletosBloque').hidden;
        $('boletosBloque').hidden = !abrir;
        $('btnBoletos').textContent = abrir ? 'Ocultar boletos' : 'Ver boletos';
        $('btnBoletos').setAttribute('aria-expanded', String(abrir));
        if (!abrir) return;
        $('boletos').innerHTML = '<tr><td colspan="4">Cargando...</td></tr>';
        const { data, error } = await db.rpc('boletos_partido', { p_partido_id: partidoActual.id });
        if (error) {
            $('boletos').innerHTML = `<tr><td colspan="4">Error: ${escapar(error.message)}</td></tr>`;
            return;
        }
        boletosPartido = data;
        pintarBoletos();
    });
    $('boletosFiltro').addEventListener('change', pintarBoletos);

    function pintarBoletos() {
        if (!boletosPartido) return;
        const filtro = $('boletosFiltro').value;
        const lista = boletosPartido.filter(b => !filtro || (filtro === 'si') === Boolean(b.usada_en));
        const entraron = boletosPartido.filter(b => b.usada_en).length;
        $('boletosResumen').textContent = `${boletosPartido.length} boletos: ${entraron} entraron, ${boletosPartido.length - entraron} no entraron.`;
        $('boletos').innerHTML = lista.length ? lista.map(b => `
            <tr>
                <td>${escapar(b.localidad)}${b.canal !== 'taquilla' ? ` <small class="detalle">${escapar(b.canal)}</small>` : ''}</td>
                <td class="num">${b.numero}</td>
                <td>${b.usada_en ? new Date(b.usada_en).toLocaleString('es', { dateStyle: 'short', timeStyle: 'short' }) : '<span class="detalle">No entró</span>'}</td>
                <td class="registro">${b.usada_email ? escapar(b.usada_email) : ''}</td>
            </tr>`).join('') : '<tr><td colspan="4">No hay boletos para mostrar.</td></tr>';
    }

    function pintarDetallePartido(lotes) {
        const p = partidoActual;
        const abierto = !p.cancelado && !p.liquidado;
        const [texto, clase] = estadoPartido(p);
        $('partidoTitulo').innerHTML = `vs ${escapar(p.rival)} · ${fechaCorta(p.fecha)} ${horaCorta(p.hora)}
            <span class="estado ${clase}">${texto}</span>`;

        $('localidades').innerHTML = localidadesPartido.map(l => `
            <tr data-localidad="${l.localidad_id}" data-precio="${l.precio}" data-impresas="${l.impresas}">
                <td>${escapar(l.nombre)}${l.cupo ? `<small class="detalle">cupo ${l.cupo}</small>` : ''}</td>
                <td class="num">${dinero(l.precio)}</td>
                <td class="num">${l.impresas}</td>
                <td class="num">${l.escaneadas}</td>
                <td class="num">${abierto
                    ? `<input type="number" class="l-devueltas" min="0" max="${l.impresas}" step="1" placeholder="0" aria-label="Devueltas de ${escapar(l.nombre)}">`
                    : (l.devueltas ?? '—')}</td>
                <td class="num l-vendidas">${l.vendidas ?? ''}</td>
                <td class="num l-importe">${l.vendidas != null ? dinero(l.vendidas * l.precio) : ''}</td>
            </tr>`).join('') + '<tr class="total"><td colspan="5">Total</td><td class="num" id="liqVendidas"></td><td class="num" id="liqTotal"></td></tr>';
        calcularLiquidacion();

        $('liquidarAcciones').hidden = !abierto;
        $('liquidarAyuda').hidden = !abierto;
        avisar($('liquidarMensaje'), p.liquidado
            ? 'Taquilla liquidada: el ingreso y la hoja de liquidación están en Movimientos.'
            : p.cancelado ? 'Partido cancelado: sus entradas ya no sirven en la puerta.' : '');

        $('talonariosBloque').hidden = !puede('dueno', 'gerente') || !abierto;
        $('taLocalidad').innerHTML = localidadesPartido
            .map(l => `<option value="${l.localidad_id}">${escapar(l.nombre)} · ${dinero(l.precio)}</option>`).join('');
        const nombreLocalidad = (id) => (localidadesPartido.find(l => l.localidad_id === id) || {}).nombre;
        $('talonarios').innerHTML = lotes.length ? lotes.map(t => `
            <tr>
                <td>${new Date(t.created_at).toLocaleString('es', { dateStyle: 'short', timeStyle: 'short' })}</td>
                <td>${escapar(nombreLocalidad(t.localidad_id))}</td>
                <td>N.º ${t.desde} al ${t.hasta} <small class="detalle">${t.hasta - t.desde + 1} entradas</small></td>
                <td class="registro">${escapar(t.creado_email)}</td>
                <td><button type="button" class="btn-chico secundario" data-reimprimir="${t.id}" data-localidad="${t.localidad_id}">Reimprimir</button></td>
            </tr>`).join('') : '<tr><td colspan="5">Todavía no se ha impreso ningún talonario.</td></tr>';
    }

    // Vendidas = impresas - devueltas, por localidad
    function lineasLiquidacion() {
        return Array.from($('localidades').querySelectorAll('tr[data-localidad]')).map(f => {
            const impresas = Number(f.dataset.impresas);
            const campo = f.querySelector('.l-devueltas');
            const devueltas = campo ? Number(campo.value || 0) : 0;
            return { fila: f, localidad_id: Number(f.dataset.localidad), precio: Number(f.dataset.precio), impresas, devueltas, vendidas: impresas - devueltas };
        });
    }

    function calcularLiquidacion() {
        if (partidoActual.cancelado || partidoActual.liquidado) {
            const total = localidadesPartido.reduce((s, l) => s + (l.vendidas || 0) * l.precio, 0);
            $('liqVendidas').textContent = localidadesPartido.reduce((s, l) => s + (l.vendidas || 0), 0);
            $('liqTotal').textContent = dinero(total);
            return;
        }
        let vendidas = 0, total = 0;
        for (const l of lineasLiquidacion()) {
            vendidas += l.vendidas;
            total += l.vendidas * l.precio;
            l.fila.querySelector('.l-vendidas').textContent = l.vendidas;
            l.fila.querySelector('.l-importe').textContent = dinero(l.vendidas * l.precio);
        }
        $('liqVendidas').textContent = vendidas;
        $('liqTotal').textContent = dinero(total);
    }
    $('localidades').addEventListener('input', calcularLiquidacion);

    $('btnLiquidar').addEventListener('click', async () => {
        const aviso = $('liquidarMensaje');
        const lineas = lineasLiquidacion();
        if (lineas.some(l => !Number.isInteger(l.devueltas) || l.devueltas < 0 || l.vendidas < 0)) {
            avisar(aviso, 'Las devueltas deben ser números enteros y no más que las impresas.', 'error');
            return;
        }
        const total = lineas.reduce((s, l) => s + l.vendidas * l.precio, 0);
        if (!total) {
            avisar(aviso, 'No hay entradas vendidas que liquidar.', 'error');
            return;
        }
        if (!confirm(`Se registrará un ingreso de ${dinero(total)} en Taquilla. ¿Continuar?`)) return;

        const ventana = window.open('', '_blank'); // se abre ya, si no el navegador la bloquea
        $('btnLiquidar').disabled = true;
        avisar(aviso, 'Registrando...');
        const { data: tx, error } = await db.rpc('liquidar_taquilla', {
            p_partido_id: partidoActual.id,
            p_fecha: $('liqFecha').value,
            p_devueltas: lineas.map(({ localidad_id, devueltas }) => ({ localidad_id, devueltas }))
        });
        $('btnLiquidar').disabled = false;
        if (error) {
            if (ventana) ventana.close();
            avisar(aviso, 'Error: ' + error.message, 'error');
            return;
        }

        let resultado = `Taquilla liquidada: ingreso de ${dinero(total)} registrado.`;
        let problema = false;
        try {
            const pdf = await hojaLiquidacion(tx, partidoActual, lineas.map(l => ({
                ...l, nombre: localidadesPartido.find(x => x.localidad_id === l.localidad_id).nombre,
                escaneadas: localidadesPartido.find(x => x.localidad_id === l.localidad_id).escaneadas
            })), total);
            const fallidos = await subirComprobantes(tx, [new File([pdf], `liquidacion-taquilla-${tx}.pdf`, { type: 'application/pdf' })]);
            if (fallidos.length) {
                problema = true;
                resultado += ' La hoja de liquidación no se pudo adjuntar; descárgala y agrégala desde Movimientos.';
            }
            const enlace = URL.createObjectURL(pdf);
            if (ventana) ventana.location = enlace;
            else location.href = enlace;
        } catch (err) {
            if (ventana) ventana.close();
            console.error('Error al generar la liquidación:', err);
            problema = true;
            resultado += ' No se pudo generar la hoja de liquidación: ' + err.message;
        }
        await cargarBoleteria();
        avisar(aviso, resultado, problema ? 'error' : 'ok');
    });

    $('btnCancelarPartido').addEventListener('click', async () => {
        if (!confirm(`¿Cancelar el partido contra ${partidoActual.rival}? Sus entradas dejarán de servir en la puerta.`)) return;
        const { error } = await db.from('partidos').update({ cancelado: true }).eq('id', partidoActual.id);
        if (error) {
            avisar($('talonarioMensaje'), 'Error: ' + error.message, 'error');
            return;
        }
        await cargarBoleteria();
    });

    // ---- Talonarios: en impresora térmica (una por ticket) o 10 por hoja carta, cada una con su QR ----
    // la impresora elegida se recuerda en este navegador
    const recordarFormato = () => {
        try {
            const guardado = localStorage.getItem('formatoTalonario');
            if (guardado) $('taFormato').value = guardado;
        } catch (_) { /* sin almacenamiento queda la térmica de 80 mm */ }
    };
    recordarFormato();
    $('taFormato').addEventListener('change', () => {
        try { localStorage.setItem('formatoTalonario', $('taFormato').value); } catch (_) { /* no importa */ }
    });

    $('talonarioForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const aviso = $('talonarioMensaje');
        const localidadId = Number($('taLocalidad').value);
        const cantidad = Number($('taCantidad').value);
        const localidad = localidadesPartido.find(l => l.localidad_id === localidadId);
        if (!confirm(`Se crearán ${cantidad} entradas de ${localidad.nombre}, válidas para entrar. Guarda las hojas impresas en un lugar seguro. ¿Continuar?`)) return;

        const ventana = window.open('', '_blank');
        $('btnTalonario').disabled = true;
        avisar(aviso, 'Generando las entradas...');
        const { data, error } = await db.rpc('generar_talonario', { p_localidad_id: localidadId, p_cantidad: cantidad });
        if (error) {
            $('btnTalonario').disabled = false;
            if (ventana) ventana.close();
            avisar(aviso, 'Error: ' + error.message, 'error');
            return;
        }
        await abrirTalonario(ventana, localidad, data, aviso);
        $('btnTalonario').disabled = false;
        $('talonarioForm').reset();
        recordarFormato();
        await cargarBoleteria();
    });

    $('talonarios').addEventListener('click', async (e) => {
        if (!e.target.dataset.reimprimir) return;
        const aviso = $('talonarioMensaje');
        const localidad = localidadesPartido.find(l => l.localidad_id === Number(e.target.dataset.localidad));
        const ventana = window.open('', '_blank');
        e.target.disabled = true;
        const { data, error } = await db.rpc('entradas_talonario', { p_talonario_id: Number(e.target.dataset.reimprimir) });
        if (error) {
            e.target.disabled = false;
            if (ventana) ventana.close();
            avisar(aviso, 'Error: ' + error.message, 'error');
            return;
        }
        await abrirTalonario(ventana, localidad, data, aviso);
        e.target.disabled = false;
    });

    async function abrirTalonario(ventana, localidad, entradas, aviso) {
        try {
            avisar(aviso, 'Armando el PDF...');
            const pdf = await pdfTalonario(partidoActual, localidad, entradas);
            const enlace = URL.createObjectURL(pdf);
            if (ventana) ventana.location = enlace;
            else location.href = enlace;
            avisar(aviso, `Listo: ${entradas.length} entradas de ${localidad.nombre} (N.º ${entradas[0].numero} al ${entradas[entradas.length - 1].numero}).`, 'ok');
        } catch (err) {
            if (ventana) ventana.close();
            console.error('Error al armar el talonario:', err);
            avisar(aviso, 'Las entradas se crearon, pero no se pudo armar el PDF: ' + err.message + '. Usa "Reimprimir".', 'error');
        }
    }

    // La librería de QR solo se descarga al imprimir el primer talonario.
    function cargarLibreriaQr() {
        if (window.qrcode) return Promise.resolve();
        return new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js';
            s.onload = resolve;
            s.onerror = () => reject(new Error('No se pudo descargar la librería de QR. Revisa tu conexión.'));
            document.head.appendChild(s);
        });
    }

    // Dibuja el QR con rectángulos (queda nítido al imprimir); une los cuadros seguidos de cada fila.
    function dibujarQr(doc, texto, x, y, lado) {
        const qr = window.qrcode(0, 'M');
        qr.addData(texto);
        qr.make();
        const n = qr.getModuleCount();
        const celda = lado / n;
        doc.setFillColor(0);
        for (let r = 0; r < n; r++) {
            for (let c = 0; c < n; c++) {
                if (!qr.isDark(r, c)) continue;
                let fin = c;
                while (fin + 1 < n && qr.isDark(r, fin + 1)) fin++;
                doc.rect(x + c * celda, y + r * celda, (fin - c + 1) * celda + 0.01, celda + 0.01, 'F');
                c = fin;
            }
        }
    }

    const codigoVisible = (c) => `${c.slice(0, 5)}-${c.slice(5)}`;

    async function pdfTalonario(partido, localidad, entradas) {
        await Promise.all([cargarLibreriaPdf(), cargarLibreriaQr()]);
        const formato = $('taFormato').value;
        if (formato !== 'carta') return pdfTermico(partido, localidad, entradas, Number(formato));
        const doc = new window.jspdf.jsPDF({ unit: 'mm', format: 'letter' });
        let escudo = null;
        try {
            escudo = await cargarImagen('img/logo.jpg');
        } catch (_) {
            // sin escudo la entrada sigue siendo válida
        }
        const [rival, liga] = await Promise.all([escudoRival(partido.id), pngParaPdf('img/liga.png')]);
        // logo de la liga (blanco) en la franja roja, a la derecha
        const ALTO_LIGA = 5.4, anchoLiga = liga ? ALTO_LIGA * liga.ancho / liga.alto : 0;
        // el escudo del rival puede no ser cuadrado: se ajusta dentro de un cuadro de 12 mm
        const LADO = 12;
        const escalaRival = rival ? LADO / Math.max(rival.ancho, rival.alto) : 0;
        const anchoRival = rival ? rival.ancho * escalaRival : 0, altoRival = rival ? rival.alto * escalaRival : 0;
        // nombre debajo de cada escudo, en una línea: se achica la letra hasta que quepa
        const nombreBajo = (texto, centro, y) => {
            doc.setFont('helvetica', 'bold');
            let tamano = 6.5;
            doc.setFontSize(tamano);
            while (doc.getTextWidth(texto) > 19 && tamano > 5) doc.setFontSize(tamano -= 0.25);
            doc.text(doc.splitTextToSize(texto, 19)[0], centro, y, { align: 'center' });
        };
        const MARGEN = 8, COLS = 2, FILAS = 5;
        const W = (215.9 - MARGEN * 2) / COLS, H = (279.4 - MARGEN * 2) / FILAS;
        const dia = new Date(partido.fecha + 'T12:00:00').toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' });
        const cuando = [dia, horaCorta(partido.hora)].filter(Boolean).join(' · ');

        entradas.forEach((e, i) => {
            const enHoja = i % (COLS * FILAS);
            if (i && !enHoja) doc.addPage('letter');
            const x = MARGEN + (enHoja % COLS) * W, y = MARGEN + Math.floor(enHoja / COLS) * H;

            // líneas de corte
            doc.setLineDashPattern([1.5, 1.5], 0).setDrawColor(170).setLineWidth(0.2);
            doc.rect(x, y, W, H);
            doc.setLineDashPattern([], 0);

            // franja con el nombre del club
            doc.setFillColor(227, 6, 19).rect(x + 2, y + 2, W - 4, 7.5, 'F');
            doc.setFillColor(201, 162, 63).rect(x + 2, y + 9.5, W - 4, 0.8, 'F');
            doc.setTextColor(255).setFont('helvetica', 'bold').setFontSize(8.5);
            doc.text(CLUB.toUpperCase(), x + 5, y + 7);
            if (liga) doc.addImage(liga.bytes, 'PNG', x + W - 4.5 - anchoLiga, y + 3.05, anchoLiga, ALTO_LIGA, 'liga');

            doc.setTextColor(0);
            if (rival) {
                // los dos escudos con su nombre debajo y "VS" en medio; la fecha abajo a todo lo ancho
                const centroClub = x + 12, centroRival = x + 34;
                if (escudo) doc.addImage(escudo, 'JPEG', centroClub - LADO / 2, y + 12.5, LADO, LADO, 'escudo');
                doc.addImage(rival.bytes, 'PNG', centroRival - anchoRival / 2, y + 12.5 + (LADO - altoRival) / 2,
                    anchoRival, altoRival, 'rival');
                doc.setFont('helvetica', 'bold').setFontSize(9).setTextColor(227, 6, 19);
                doc.text('VS', x + 23, y + 20, { align: 'center' });
                doc.setTextColor(0);
                nombreBajo('ATLÉTICO BALBOA', centroClub, y + 27.3);
                nombreBajo(partido.rival.toUpperCase(), centroRival, y + 27.3);
                doc.setFont('helvetica', 'normal').setFontSize(7);
                doc.text(doc.splitTextToSize(cuando, 56)[0], x + 5, y + 31);
                if (partido.torneo) doc.text(doc.splitTextToSize(partido.torneo, 56)[0], x + 5, y + 34.3);
            } else {
                const xt = escudo ? x + 22 : x + 5;
                if (escudo) doc.addImage(escudo, 'JPEG', x + 4, y + 13, 15, 15, 'escudo');
                doc.setFontSize(10.5);
                doc.text(doc.splitTextToSize(`vs ${partido.rival}`, 40).slice(0, 2), xt, y + 17);
                doc.setFont('helvetica', 'normal').setFontSize(7);
                doc.text(doc.splitTextToSize(cuando, 42).slice(0, 2), xt, y + 26);
                if (partido.torneo) doc.text(doc.splitTextToSize(partido.torneo, 42)[0], xt, y + 30.5);
            }

            doc.setFont('helvetica', 'bold').setFontSize(13).setTextColor(227, 6, 19);
            doc.text(doc.splitTextToSize(localidad.nombre.toUpperCase(), 56)[0], x + 5, y + 40);
            doc.setTextColor(0).setFontSize(13);
            doc.text(dinero(localidad.precio), x + 5, y + 46.5);
            doc.setFont('helvetica', 'normal').setFontSize(9);
            doc.text(`N.º ${String(e.numero).padStart(4, '0')}`, x + 32, y + 46.5);

            // el QR necesita borde blanco alrededor para que el celular lo lea rápido
            const lado = 29;
            dibujarQr(doc, e.codigo, x + W - lado - 6, y + 15, lado);
            doc.setFont('courier', 'bold').setFontSize(8.5);
            doc.text(codigoVisible(e.codigo), x + W - 6 - lado / 2, y + 48.5, { align: 'center' });

            doc.setFont('helvetica', 'normal').setFontSize(5.5).setTextColor(110);
            doc.text('Válida para una persona y una sola entrada. No se aceptan copias.', x + 5, y + H - 2.5);
        });
        return doc.output('blob');
    }

    // Impresora térmica: una entrada por página del tamaño del ticket, así la impresora corta entre una y otra.
    // Se diseña para 80 mm (72 mm imprimibles) y en 58 mm (48 mm) todo se escala. Solo negro: la térmica no imprime color.
    async function pdfTermico(partido, localidad, entradas, papel) {
        const M = papel === 58 ? 5 : 4, k = (papel - M * 2) / 72;
        const ALTO = 76 * k;
        const doc = new window.jspdf.jsPDF({ unit: 'mm', format: [papel, ALTO], orientation: papel > ALTO ? 'landscape' : 'portrait' });
        const X = (d) => M + d * k, Y = (d) => d * k;
        const letra = (pt) => doc.setFontSize(Math.max(pt * k, 5));
        // achica la letra hasta que el texto quepa en el ancho (en mm del diseño de 80)
        const ajustar = (texto, pt, ancho) => {
            letra(pt);
            while (doc.getTextWidth(texto) > ancho * k && pt * k > 5) letra(pt -= 0.25);
            return doc.splitTextToSize(texto, ancho * k)[0];
        };
        // ¿cabe con la letra más chica que se permite?
        const cabe = (texto, ancho) => doc.setFontSize(5).getTextWidth(texto) <= ancho * k;

        let escudo = null;
        try {
            escudo = await cargarImagen('img/logo.jpg');
        } catch (_) {
            // sin escudo la entrada sigue siendo válida
        }
        const [rival, liga] = await Promise.all([escudoRival(partido.id), pngParaPdf('img/liga.png')]);
        const ALTO_LIGA = 4.8, anchoLiga = liga ? ALTO_LIGA * liga.ancho / liga.alto : 0;
        const LADO = 13;
        const escalaRival = rival ? LADO / Math.max(rival.ancho, rival.alto) : 0;
        const anchoRival = rival ? rival.ancho * escalaRival : 0, altoRival = rival ? rival.alto * escalaRival : 0;
        const dia = new Date(partido.fecha + 'T12:00:00').toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' });
        const cuando = [dia, horaCorta(partido.hora)].filter(Boolean).join(' · ');

        entradas.forEach((e, i) => {
            if (i) doc.addPage([papel, ALTO], papel > ALTO ? 'landscape' : 'portrait');
            doc.setTextColor(0);

            // franja negra con el nombre del club y el logo de la liga (blanco)
            doc.setFillColor(0).rect(X(0), Y(2), 72 * k, 7 * k, 'F');
            doc.setTextColor(255).setFont('helvetica', 'bold');
            // en 58 mm el nombre completo no cabe: va abreviado
            const espacio = 72 - 6 - (liga ? anchoLiga + 2 : 0);
            doc.text(ajustar(cabe(CLUB.toUpperCase(), espacio) ? CLUB.toUpperCase() : 'C.D. ATLÉTICO BALBOA', 8.5, espacio), X(3), Y(6.9));
            if (liga) doc.addImage(liga.bytes, 'PNG', X(72 - 2.5 - anchoLiga), Y(3.1), anchoLiga * k, ALTO_LIGA * k, 'liga');
            doc.setTextColor(0);

            if (rival) {
                if (escudo) doc.addImage(escudo, 'JPEG', X(18 - LADO / 2), Y(11), LADO * k, LADO * k, 'escudo');
                doc.addImage(rival.bytes, 'PNG', X(54 - anchoRival / 2), Y(11 + (LADO - altoRival) / 2),
                    anchoRival * k, altoRival * k, 'rival');
                doc.setFont('helvetica', 'bold');
                letra(11);
                doc.text('VS', X(36), Y(19), { align: 'center' });
                doc.text(ajustar('ATLÉTICO BALBOA', 7, 32), X(18), Y(27.5), { align: 'center' });
                doc.text(ajustar(partido.rival.toUpperCase(), 7, 32), X(54), Y(27.5), { align: 'center' });
            } else {
                if (escudo) doc.addImage(escudo, 'JPEG', X(4), Y(11), LADO * k, LADO * k, 'escudo');
                doc.setFont('helvetica', 'bold');
                doc.text(ajustar(`vs ${partido.rival}`, 11, 50), X(22), Y(19.5));
            }
            doc.setFont('helvetica', 'normal');
            doc.text(ajustar(cuando, 7.5, 72), X(36), Y(31.8), { align: 'center' });
            if (partido.torneo) doc.text(ajustar(partido.torneo, 7, 72), X(36), Y(35.2), { align: 'center' });
            doc.setDrawColor(0).setLineWidth(0.3).line(X(0), Y(37.5), X(72), Y(37.5));

            // datos de la entrada a la izquierda y el QR a la derecha
            doc.setFont('helvetica', 'bold');
            doc.text(ajustar(localidad.nombre.toUpperCase(), 14, 38), X(0), Y(45));
            letra(14);
            doc.text(dinero(localidad.precio), X(0), Y(52));
            doc.setFont('helvetica', 'normal');
            letra(9);
            doc.text(`N.º ${String(e.numero).padStart(4, '0')}`, X(0), Y(57.5));
            doc.setFont('courier', 'bold');
            letra(9.5);
            doc.text(codigoVisible(e.codigo), X(0), Y(63.5));
            dibujarQr(doc, e.codigo, X(42), Y(39.5), 30 * k);

            doc.setFont('helvetica', 'normal');
            const aviso = 'Válida para una persona y una sola entrada. No se aceptan copias.';
            doc.text(ajustar(cabe(aviso, 72) ? aviso : 'Una sola entrada por persona. No se aceptan copias.', 5.5, 72),
                X(36), Y(73.5), { align: 'center' });
        });
        return doc.output('blob');
    }

    // Hoja de liquidación de taquilla: se imprime, se firma y queda adjunta al ingreso.
    async function hojaLiquidacion(tx, partido, lineas, total) {
        await cargarLibreriaPdf();
        const doc = new window.jspdf.jsPDF({ unit: 'mm', format: 'letter' });
        const X = 18, DERECHA = 215.9 - 18;
        let escudo = null;
        try {
            escudo = await cargarImagen('img/logo.jpg');
        } catch (_) {
            // sin escudo la hoja sigue siendo válida
        }
        let y = 15;
        if (escudo) doc.addImage(escudo, 'JPEG', X, y, 22, 22);
        const xt = escudo ? X + 26 : X;
        doc.setFont('helvetica', 'bold').setFontSize(13).text(CLUB, xt, y + 8);
        doc.setFont('helvetica', 'normal').setFontSize(9).text('La Unión, El Salvador', xt, y + 13);
        doc.setFont('helvetica', 'bold').setFontSize(11).text('LIQUIDACIÓN DE TAQUILLA', DERECHA, y + 6, { align: 'right' });
        doc.setFont('helvetica', 'normal').setFontSize(9).text(`Ingreso N.º ${tx}`, DERECHA, y + 11.5, { align: 'right' });
        doc.setDrawColor(227, 6, 19).setLineWidth(1).line(X, y + 26, DERECHA, y + 26);
        doc.setDrawColor(201, 162, 63).setLineWidth(0.5).line(X, y + 27.3, DERECHA, y + 27.3);

        y += 36;
        doc.setFontSize(10);
        doc.text(`Partido: vs ${partido.rival}${partido.torneo ? ' (' + partido.torneo + ')' : ''}`, X, y);
        doc.text(`Fecha del partido: ${fechaCorta(partido.fecha)} ${horaCorta(partido.hora)}`, X, y += 6);
        doc.text(`Liquidó: ${perfil.nombre || perfil.email} · ${new Date().toLocaleString('es', { dateStyle: 'short', timeStyle: 'short' })}`, X, y += 6);

        const cols = [['Localidad', X + 2, 'left'], ['Precio', X + 80, 'right'], ['Impresas', X + 100, 'right'], ['Devueltas', X + 122, 'right'],
            ['Vendidas', X + 142, 'right'], ['Entraron', X + 160, 'right'], ['Importe', DERECHA - 2, 'right']];
        y += 10;
        doc.setDrawColor(0).setLineWidth(0.3).line(X, y - 4.5, DERECHA, y - 4.5);
        doc.setFont('helvetica', 'bold').setFontSize(9);
        cols.forEach(([t, cx, a]) => doc.text(t, cx, y, { align: a }));
        doc.line(X, y + 2, DERECHA, y + 2);
        doc.setFont('helvetica', 'normal');
        for (const l of lineas) {
            y += 7;
            [l.nombre, dinero(l.precio), l.impresas, l.devueltas, l.vendidas, l.escaneadas, dinero(l.vendidas * l.precio)]
                .forEach((v, i) => doc.text(String(v), cols[i][1], y, { align: cols[i][2] }));
        }
        doc.line(X, y += 3, DERECHA, y);
        doc.setFont('helvetica', 'bold').setFontSize(11);
        doc.text('TOTAL', cols[5][1], y += 7, { align: 'right' });
        doc.text(dinero(total), DERECHA - 2, y, { align: 'right' });
        doc.setFont('helvetica', 'normal').setFontSize(8.5);
        doc.text(montoEnLetras(total), X, y);

        const sinCobrar = lineas.filter(l => l.escaneadas > l.vendidas);
        if (sinCobrar.length) {
            doc.setTextColor(180, 83, 9);
            doc.text(doc.splitTextToSize('Atención: entraron más personas que entradas vendidas en ' +
                sinCobrar.map(l => `${l.nombre} (${l.escaneadas - l.vendidas} de más)`).join(', ') +
                '. Revisar entradas que no se devolvieron ni se cobraron.', DERECHA - X), X, y += 10);
            doc.setTextColor(0);
        }

        y = Math.max(y + 40, 200);
        doc.setFontSize(9);
        [[X + 40, 'Entregó (taquilla)'], [DERECHA - 40, 'Recibió (tesorería)']].forEach(([cx, t]) => {
            doc.line(cx - 32, y, cx + 32, y);
            doc.text(t, cx, y + 5, { align: 'center' });
        });
        return doc.output('blob');
    }

    // ---- Puerta: validar entradas con la cámara del celular ----
    // Lector propio (cámara + jsQR) en vez de una librería que arma el video por su cuenta:
    // en iPhone el video tiene que llevar playsinline y muted, si no la cámara se enciende pero no se ve.
    let lector = null;          // { stream, video } mientras la cámara está encendida
    let validando = false;
    let ultimoCodigo = '', ultimoEn = 0;
    let dejoPasar = 0;

    function cargarLibreriaLector() {
        if (window.jsQR) return Promise.resolve();
        return new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js';
            s.onload = resolve;
            s.onerror = () => reject(new Error('No se pudo descargar el lector de QR. Revisa tu conexión.'));
            document.head.appendChild(s);
        });
    }

    async function encenderCamara() {
        $('btnCamara').disabled = true;
        let stream = null;
        try {
            await cargarLibreriaLector();
            stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
            const video = document.createElement('video');
            video.setAttribute('playsinline', '');
            video.muted = true;
            video.srcObject = stream;
            $('lector').replaceChildren(video);
            await video.play();
            lector = { stream, video };
            $('btnCamara').textContent = 'Apagar cámara';
            leerCuadros(lector);
        } catch (err) {
            console.error('Error al encender la cámara:', err);
            if (stream) stream.getTracks().forEach(t => t.stop());
            $('lector').replaceChildren();
            lector = null;
            mostrarResultado('aviso', 'No se pudo encender la cámara', 'Da permiso de cámara al navegador, o escribe el código a mano.');
        }
        $('btnCamara').disabled = false;
    }

    // Unas 8 veces por segundo copia el cuadro del video (achicado) y busca un QR.
    function leerCuadros(activo) {
        const lienzo = document.createElement('canvas');
        const ctx = lienzo.getContext('2d', { willReadFrequently: true });
        const paso = () => {
            if (lector !== activo) return;
            const { video } = activo;
            if (video.videoWidth) {
                const escala = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight));
                lienzo.width = Math.round(video.videoWidth * escala);
                lienzo.height = Math.round(video.videoHeight * escala);
                ctx.drawImage(video, 0, 0, lienzo.width, lienzo.height);
                const qr = window.jsQR(ctx.getImageData(0, 0, lienzo.width, lienzo.height).data, lienzo.width, lienzo.height,
                    { inversionAttempts: 'dontInvert' });
                if (qr && qr.data) validarEntrada(qr.data);
            }
            setTimeout(paso, 120);
        };
        paso();
    }

    async function apagarCamara() {
        if (!lector) return;
        lector.stream.getTracks().forEach(t => t.stop());
        lector = null;
        $('lector').replaceChildren();
        $('btnCamara').textContent = 'Encender cámara';
    }

    $('btnCamara').addEventListener('click', () => (lector ? apagarCamara() : encenderCamara()));

    $('codigoForm').addEventListener('submit', (e) => {
        e.preventDefault();
        validarEntrada($('codigoManual').value, true);
        $('codigoManual').value = '';
    });

    // Pitido corto: agudo si pasa, grave si no (en la puerta hay ruido y no siempre se ve la pantalla).
    function pitar(bien) {
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const o = ctx.createOscillator();
            o.frequency.value = bien ? 1200 : 300;
            o.connect(ctx.destination);
            o.start();
            o.stop(ctx.currentTime + (bien ? 0.15 : 0.5));
            o.onended = () => ctx.close();
        } catch (_) { /* sin sonido */ }
        if (navigator.vibrate) navigator.vibrate(bien ? 100 : [200, 100, 200]);
    }

    function mostrarResultado(clase, titulo, detalle) {
        const caja = $('resultadoEntrada');
        caja.className = 'resultado-entrada ' + clase;
        caja.innerHTML = `<strong>${escapar(titulo)}</strong>${detalle ? `<span>${escapar(detalle)}</span>` : ''}`;
        caja.hidden = false;
    }

    async function validarEntrada(texto, manual) {
        const codigo = String(texto).toUpperCase().replace(/[^A-Z0-9]/g, '');
        // la cámara lee el mismo QR varias veces por segundo
        if (validando || (!manual && codigo === ultimoCodigo && Date.now() - ultimoEn < 4000)) return;
        validando = true;
        ultimoCodigo = codigo;
        const { data: r, error } = await db.rpc('validar_entrada', { p_codigo: codigo });
        ultimoEn = Date.now();
        validando = false;

        if (error) {
            pitar(false);
            mostrarResultado('aviso', 'No se pudo revisar', 'Sin conexión o sin permiso. Intenta otra vez. ' + error.message);
            return;
        }
        const lugar = r.localidad ? `${r.localidad} · N.º ${String(r.numero).padStart(4, '0')}` : '';
        if (r.resultado === 'ok') {
            dejoPasar++;
            $('contadorPuerta').textContent = `Desde este celular han pasado ${dejoPasar} personas.`;
            pitar(true);
            mostrarResultado('ok', 'PASA', lugar);
            return;
        }
        pitar(false);
        if (r.resultado === 'usada') {
            const hora = new Date(r.usada_en).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
            mostrarResultado('no', 'NO PASA: ya se usó', `${lugar}. Entró a las ${hora} (${r.usada_email || 'otro portero'}).`);
        } else if (r.resultado === 'otro_dia') {
            mostrarResultado('no', 'NO PASA: no es de hoy', `Es del partido vs ${r.rival} del ${fechaCorta(r.fecha)}.`);
        } else if (r.resultado === 'cancelado') {
            mostrarResultado('no', 'NO PASA: partido cancelado', `vs ${r.rival} del ${fechaCorta(r.fecha)}.`);
        } else {
            mostrarResultado('no', 'NO PASA: entrada no válida', 'El código no es de una entrada del club.');
        }
    }

    // ---- Personal del club ----
    async function cargarPersonal() {
        const { data, error } = await db.from('personal').select('id, nombre, grupo, cargo, documento, salario, otros, isr, forma_pago, activo');
        if (error) {
            avisar($('personalMensaje'), 'Error: ' + error.message, 'error');
            return;
        }
        personal = data.sort(ordenarPorGrupo);
        pintarPersonal();
    }

    function pintarPersonal() {
        const monto = (clase, valor) => `<td><input type="number" class="${clase}" value="${Number(valor)}" min="0" step="0.01"></td>`;
        $('personal').innerHTML = personal.length
            ? personal.map(p => `
                <tr data-persona="${p.id}" class="${p.activo ? '' : 'anulada'}">
                    <td><input type="text" class="pe-nombre" value="${escapar(p.nombre)}" maxlength="120"></td>
                    <td><select class="pe-grupo">${ORDEN_GRUPOS.map(g =>
                        `<option value="${g}" ${p.grupo === g ? 'selected' : ''}>${GRUPO_PERSONA[g]}</option>`).join('')}</select></td>
                    <td><input type="text" class="pe-cargo" value="${escapar(p.cargo)}" maxlength="80"></td>
                    <td><input type="text" class="pe-documento" value="${escapar(p.documento)}" maxlength="40"></td>
                    ${monto('pe-salario', p.salario)}${monto('pe-otros', p.otros)}${monto('pe-isr', p.isr)}
                    <td><select class="pe-forma">${opcionesFormaPago(p.forma_pago)}</select></td>
                    <td><input type="checkbox" class="pe-activo" ${p.activo ? 'checked' : ''}></td>
                    <td><button type="button" class="btn-chico" data-guardar>Guardar</button></td>
                </tr>`).join('')
            : '<tr><td colspan="10" class="ayuda">Todavía no hay personal registrado.</td></tr>';
    }

    $('personalForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const nuevo = {
            nombre: $('peNombre').value.trim(),
            grupo: $('peGrupo').value,
            cargo: $('peCargo').value.trim() || null,
            documento: $('peDocumento').value.trim() || null,
            salario: Number($('peSalario').value || 0),
            otros: Number($('peOtros').value || 0),
            isr: Number($('peIsr').value || 0),
            forma_pago: $('peForma').value
        };
        const { error } = await db.from('personal').insert([nuevo]);
        if (error) {
            avisar($('personalMensaje'), 'Error: ' + error.message, 'error');
            return;
        }
        avisar($('personalMensaje'), `${nuevo.nombre} agregado.`, 'ok');
        $('personalForm').reset();
        $('peNombre').focus();
        await cargarPersonal();
        pintarPlanilla();
    });

    $('personal').addEventListener('click', async (e) => {
        if (!('guardar' in e.target.dataset)) return;
        const fila = e.target.closest('tr');
        const valor = (clase) => fila.querySelector('.' + clase).value.trim();
        const cambios = {
            nombre: valor('pe-nombre'),
            grupo: valor('pe-grupo'),
            cargo: valor('pe-cargo') || null,
            documento: valor('pe-documento') || null,
            salario: Number(valor('pe-salario') || 0),
            otros: Number(valor('pe-otros') || 0),
            isr: Number(valor('pe-isr') || 0),
            forma_pago: valor('pe-forma'),
            activo: fila.querySelector('.pe-activo').checked
        };
        e.target.disabled = true;
        const { error } = await db.from('personal').update(cambios).eq('id', Number(fila.dataset.persona));
        e.target.disabled = false;
        if (error) {
            avisar($('personalMensaje'), 'Error: ' + error.message, 'error');
            return;
        }
        avisar($('personalMensaje'), `${cambios.nombre} actualizado.`, 'ok');
        await cargarPersonal();
        pintarPlanilla();
    });

    // ---- Ajustes: datos para documentos (solo dueño) ----
    async function pintarAjustesDocumentos() {
        await cargarAjustes();
        $('ajFirmanteNombre').value = ajustes.firmante_nombre || '';
        $('ajFirmanteCargo').value = ajustes.firmante_cargo || '';
        $('ajFirmanteDui').value = ajustes.firmante_dui || '';
    }

    $('documentosForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const aviso = $('documentosMensaje');
        const valores = {
            firmante_nombre: $('ajFirmanteNombre').value.trim(),
            firmante_cargo: $('ajFirmanteCargo').value.trim(),
            firmante_dui: $('ajFirmanteDui').value.trim()
        };
        for (const [clave, valor] of Object.entries(valores)) {
            const { error } = await db.from('ajustes').update({ valor }).eq('clave', clave);
            if (error) {
                avisar(aviso, 'Error: ' + error.message, 'error');
                return;
            }
        }
        await cargarAjustes();
        avisar(aviso, 'Datos guardados. Se usarán en los próximos recibos y planillas.', 'ok');
    });

    // ---- Ajustes: usuarios (solo dueño) ----
    const usuarios = $('usuarios');
    const usuariosMensaje = $('usuariosMensaje');

    async function cargarUsuarios() {
        const { data, error } = await db
            .from('perfiles')
            .select('user_id, email, nombre, rol, activo')
            .order('created_at');
        if (error) {
            avisar(usuariosMensaje, 'Error: ' + error.message, 'error');
            return;
        }

        usuarios.innerHTML = data.map(u => {
            const esYo = u.user_id === perfil.user_id;
            const opciones = ['<option value="">Sin acceso</option>']
                .concat(Object.entries(ROLES).map(([valor, texto]) =>
                    `<option value="${valor}" ${u.rol === valor ? 'selected' : ''}>${texto}</option>`))
                .join('');
            return `
                <tr data-usuario="${u.user_id}">
                    <td>${escapar(u.email)}</td>
                    <td><input type="text" class="u-nombre" value="${escapar(u.nombre)}" maxlength="80" ${esYo ? 'disabled' : ''}></td>
                    <td><select class="u-rol" ${esYo ? 'disabled' : ''}>${opciones}</select></td>
                    <td><input type="checkbox" class="u-activo" ${u.activo ? 'checked' : ''} ${esYo ? 'disabled' : ''}></td>
                    <td class="acciones">${esYo ? '<span class="nota">Tú</span>' : `
                        <button type="button" class="btn-chico" data-guardar>Guardar</button>
                        <button type="button" class="btn-chico secundario" data-clave>Nueva contraseña</button>`}</td>
                </tr>`;
        }).join('');
        avisar(usuariosMensaje, '');
    }

    // Crear usuarios y restablecer contraseñas requiere la clave de administrador,
    // por eso lo hace la función de servidor "admin-usuarios" (verifica que seas dueño).
    async function adminUsuarios(cuerpo) {
        const { data, error } = await db.functions.invoke('admin-usuarios', { body: cuerpo });
        if (!error) return { data };
        let texto = error.message;
        try { texto = (await error.context.json()).error || texto; } catch (_) { /* respuesta sin JSON */ }
        return { error: texto };
    }

    function generarClave() {
        const letras = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
        const azar = crypto.getRandomValues(new Uint32Array(12));
        return Array.from(azar, n => letras[n % letras.length]).join('');
    }

    $('btnGenerarClave').addEventListener('click', () => { $('nuClave').value = generarClave(); });

    $('nuevoUsuarioForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const aviso = $('nuevoUsuarioMensaje');
        const email = $('nuEmail').value.trim();
        const rol = $('nuRol').value;

        if (rol === 'dueno' && !confirm(`${email} tendrá control total del sistema, igual que tú. ¿Continuar?`)) return;

        $('btnCrearUsuario').disabled = true;
        avisar(aviso, 'Creando usuario...');
        const { error } = await adminUsuarios({
            accion: 'crear',
            email,
            nombre: $('nuNombre').value.trim(),
            rol,
            password: $('nuClave').value
        });
        $('btnCrearUsuario').disabled = false;

        if (error) {
            avisar(aviso, 'Error: ' + error, 'error');
            return;
        }
        avisar(aviso, `Usuario ${email} creado como ${ROLES[rol]}. Contraseña temporal: ${$('nuClave').value}`, 'ok');
        $('nuevoUsuarioForm').reset();
        cargarUsuarios();
    });

    usuarios.addEventListener('click', async (e) => {
        if ('clave' in e.target.dataset) {
            const fila = e.target.closest('tr');
            const email = fila.cells[0].textContent;
            const clave = generarClave();
            if (!confirm(`¿Asignar una contraseña nueva a ${email}? La actual dejará de funcionar.`)) return;

            e.target.disabled = true;
            const { error } = await adminUsuarios({ accion: 'clave', user_id: fila.dataset.usuario, password: clave });
            e.target.disabled = false;

            if (error) avisar(usuariosMensaje, 'Error: ' + error, 'error');
            else avisar(usuariosMensaje, `Nueva contraseña de ${email}: ${clave} — entrégasela por un medio privado.`, 'ok');
            return;
        }

        if (!('guardar' in e.target.dataset)) return;
        const fila = e.target.closest('tr');
        const cambios = {
            nombre: fila.querySelector('.u-nombre').value.trim() || null,
            rol: fila.querySelector('.u-rol').value || null,
            activo: fila.querySelector('.u-activo').checked
        };

        e.target.disabled = true;
        const { error } = await db.from('perfiles').update(cambios).eq('user_id', fila.dataset.usuario);
        e.target.disabled = false;

        if (error) avisar(usuariosMensaje, 'Error: ' + error.message, 'error');
        else avisar(usuariosMensaje, 'Usuario actualizado.', 'ok');
    });

    // ---- Ajustes: categorías (solo dueño) ----
    const tablaCategorias = $('categorias');
    const categoriasMensaje = $('categoriasMensaje');

    function pintarCategorias() {
        tablaCategorias.innerHTML = categorias.map(c => `
            <tr class="${c.activa ? '' : 'anulada'}">
                <td>${escapar(c.nombre)}</td>
                <td>${c.tipo === 'ingreso' ? 'Ingreso' : 'Egreso'}</td>
                <td>${c.activa ? 'Activa' : 'Inactiva'}</td>
                <td><button type="button" class="btn-chico" data-categoria="${c.id}" data-activa="${c.activa}">
                    ${c.activa ? 'Desactivar' : 'Activar'}</button></td>
            </tr>`).join('');
    }

    $('categoriaForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const nombre = $('nuevaCategoria').value.trim();
        if (!nombre) return;

        const { error } = await db.from('categorias').insert([{ nombre, tipo: $('nuevaCategoriaTipo').value }]);
        if (error) {
            avisar(categoriasMensaje, 'Error: ' + error.message, 'error');
            return;
        }
        $('categoriaForm').reset();
        avisar(categoriasMensaje, 'Categoría agregada.', 'ok');
        await cargarCategorias();
        pintarCategorias();
    });

    tablaCategorias.addEventListener('click', async (e) => {
        const id = e.target.dataset.categoria;
        if (!id) return;

        const activa = e.target.dataset.activa !== 'true';
        const { error } = await db.from('categorias').update({ activa }).eq('id', Number(id));
        if (error) {
            avisar(categoriasMensaje, 'Error: ' + error.message, 'error');
            return;
        }
        avisar(categoriasMensaje, activa ? 'Categoría activada.' : 'Categoría desactivada (ya no aparece al registrar).', 'ok');
        await cargarCategorias();
        pintarCategorias();
    });

    // ---- Mi cuenta: cambiar la propia contraseña (todos los roles) ----
    $('claveForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const aviso = $('claveMensaje');
        const nueva = $('claveNueva').value;

        if (nueva !== $('claveRepetir').value) {
            avisar(aviso, 'Las contraseñas no coinciden.', 'error');
            return;
        }

        $('btnCambiarClave').disabled = true;
        const { error } = await db.auth.updateUser({ password: nueva });
        $('btnCambiarClave').disabled = false;

        if (error) {
            avisar(aviso, 'Error: ' + error.message, 'error');
            return;
        }
        $('claveForm').reset();
        avisar(aviso, 'Contraseña actualizada.', 'ok');
    });
})();
