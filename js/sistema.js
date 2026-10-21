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
    const ROLES = { dueno: 'Dueño', gerente: 'Gerente', secretaria: 'Secretaria' };

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
        perfil = null;
        $('pantallaLogin').hidden = false;
        $('app').hidden = true;
        $('sesion').hidden = true;
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
        $('app').hidden = false;

        document.querySelectorAll('.nav a').forEach(a => {
            a.hidden = !a.dataset.roles.split(' ').includes(perfil.rol);
        });
        $('tituloHistorial').textContent = puede('secretaria') ? 'Mis movimientos registrados' : 'Historial';

        await cargarCategorias();
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
        let id = location.hash.slice(1) || 'movimientos';
        const enlace = document.querySelector(`.nav a[data-seccion="${CSS.escape(id)}"]`);
        if (!enlace || enlace.hidden) id = 'movimientos';

        document.querySelectorAll('.seccion').forEach(s => s.classList.toggle('activa', s.id === id));
        document.querySelectorAll('.nav a').forEach(a => a.classList.toggle('activo', a.dataset.seccion === id));

        if (id === 'dashboard') cargarDashboard();
        if (id === 'movimientos') cargarHistorial();
        if (id === 'ajustes') { cargarUsuarios(); pintarCategorias(); }
        if (id === 'cuenta') $('cuentaDatos').textContent = `${perfil.email} · ${ROLES[perfil.rol]}`;
    }
    window.addEventListener('hashchange', mostrarSeccion);

    // ---- Categorías ----
    async function cargarCategorias() {
        const { data, error } = await db.from('categorias').select('id, nombre, tipo, activa').order('id');
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
    }

    tipo.addEventListener('change', llenarCategoriasFormulario);
    fecha.value = hoy();

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const registro = {
            fecha: fecha.value,
            concepto: $('concepto').value.trim(),
            monto: Number($('monto').value),
            tipo: tipo.value,
            categoria_id: Number($('categoria').value)
        };

        if (!registro.concepto || !(registro.monto > 0) || !registro.categoria_id) {
            avisar(mensaje, 'Revisa el concepto, la categoría y que el monto sea mayor a 0.', 'error');
            return;
        }

        $('btnGuardar').disabled = true;
        avisar(mensaje, 'Guardando...');

        // Quién lo registró lo pone la base de datos (trigger), no el navegador.
        const { error } = await db.from('transacciones').insert([registro]);

        $('btnGuardar').disabled = false;

        if (error) {
            console.error('Error de Supabase:', error);
            avisar(mensaje, 'Error: ' + error.message, 'error');
            return;
        }

        avisar(mensaje, '¡Movimiento guardado!', 'ok');
        form.reset();
        llenarCategoriasFormulario();
        fecha.value = hoy();
        cargarHistorial();
    });

    // ---- Historial (la base ya filtra: la secretaria solo recibe lo suyo) ----
    const historial = $('historial');
    const historialMensaje = $('historialMensaje');

    async function cargarHistorial() {
        avisar(historialMensaje, 'Cargando...');

        let consulta = db
            .from('transacciones')
            .select('id, fecha, concepto, monto, tipo, categoria_id, registrado_email, anulada, anulada_email, anulada_en, motivo_anulacion')
            .order('fecha', { ascending: false })
            .order('id', { ascending: false })
            .limit(LIMITE_HISTORIAL);

        if ($('fDesde').value) consulta = consulta.gte('fecha', $('fDesde').value);
        if ($('fHasta').value) consulta = consulta.lte('fecha', $('fHasta').value);
        if ($('fTipo').value) consulta = consulta.eq('tipo', $('fTipo').value);
        if ($('fCategoria').value) consulta = consulta.eq('categoria_id', Number($('fCategoria').value));
        if (!$('fAnuladas').checked) consulta = consulta.eq('anulada', false);

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

    function pintarTotales(movs) {
        const vigentes = movs.filter(m => !m.anulada);
        const suma = (t) => vigentes.filter(m => m.tipo === t).reduce((s, m) => s + Number(m.monto), 0);
        const ingresos = suma('ingreso');
        const egresos = suma('egreso');
        $('totales').innerHTML = `
            <div><span>Ingresos</span><strong class="ingreso">${dinero(ingresos)}</strong></div>
            <div><span>Egresos</span><strong class="egreso">${dinero(egresos)}</strong></div>
            <div><span>Neto</span><strong>${dinero(ingresos - egresos)}</strong></div>`;
    }

    function filaMovimiento(m) {
        const signo = m.tipo === 'ingreso' ? '+' : '−';
        const anulacion = m.anulada
            ? `<div class="nota">Anulado por ${escapar(m.anulada_email)} el ${fechaCorta(m.anulada_en.slice(0, 10))}: ${escapar(m.motivo_anulacion)}</div>`
            : '';
        const boton = !m.anulada && puede('dueno', 'gerente')
            ? `<button type="button" class="btn-chico" data-anular="${m.id}">Anular</button>`
            : '';
        return `
            <tr class="${m.anulada ? 'anulada' : ''}">
                <td>${fechaCorta(m.fecha)}</td>
                <td>${escapar(m.concepto)}${anulacion}</td>
                <td>${escapar(nombreCategoria(m.categoria_id))}</td>
                <td class="num ${m.tipo}">${signo}${dinero(m.monto)}</td>
                <td class="registro">${escapar(m.registrado_email)}</td>
                <td>${boton}</td>
            </tr>`;
    }

    $('filtrosForm').addEventListener('submit', (e) => {
        e.preventDefault();
        cargarHistorial();
    });

    historial.addEventListener('click', async (e) => {
        const id = e.target.dataset.anular;
        if (!id) return;

        const motivo = prompt('¿Por qué se anula este movimiento? (queda registrado)');
        if (motivo === null) return;

        e.target.disabled = true;
        const { error } = await db.rpc('anular_transaccion', { p_id: Number(id), p_motivo: motivo });
        if (error) {
            e.target.disabled = false;
            avisar(historialMensaje, 'Error: ' + error.message, 'error');
            return;
        }
        cargarHistorial();
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
                .select('id, fecha, concepto, monto, tipo, categoria_id, registrado_email')
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
                    <td>${escapar(m.concepto)}</td>
                    <td>${escapar(nombreCategoria(m.categoria_id))}</td>
                    <td class="num ${m.tipo}">${m.tipo === 'ingreso' ? '+' : '−'}${dinero(m.monto)}</td>
                    <td class="registro">${escapar(m.registrado_email)}</td>
                </tr>`).join('')
            : '<tr><td colspan="5" class="ayuda">No hay movimientos en este periodo.</td></tr>';
        $('reportePie').textContent = `${r.movs.length} movimientos · No incluye movimientos anulados · `
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
            ['Atlético Balboa — Corte de caja'],
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

        const detalle = [['Fecha', 'Tipo', 'Concepto', 'Categoría', 'Monto (USD)', 'Registró']]
            .concat(r.movs.map(m => [
                fechaCorta(m.fecha),
                m.tipo === 'ingreso' ? 'Ingreso' : 'Egreso',
                m.concepto,
                nombreCategoria(m.categoria_id),
                m.tipo === 'ingreso' ? Number(m.monto) : -Number(m.monto),
                m.registrado_email
            ]));
        const hojaDetalle = XLSX.utils.aoa_to_sheet(detalle);
        hojaDetalle['!cols'] = [{ wch: 11 }, { wch: 9 }, { wch: 40 }, { wch: 30 }, { wch: 14 }, { wch: 30 }];
        XLSX.utils.book_append_sheet(libro, hojaDetalle, 'Movimientos');

        XLSX.writeFile(libro, `corte-caja_${r.desde}_a_${r.hasta}.xlsx`);
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
