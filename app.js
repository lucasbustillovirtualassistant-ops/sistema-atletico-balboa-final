// 1. Inicialización única de Supabase
const supabaseUrl = 'https://nhrncnxtwcwdybptiirr.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5ocm5jbnh0d2N3ZHlicHRpaXJyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE4MDU3NDcsImV4cCI6MjA5NzM4MTc0N30.GDUZyAxlFAga8j9GHlocodS_NrMKzjQEHc8FdO0AkjM'; // ASEGÚRATE DE USAR LA REGENERADA
const supabase = supabaseClient.createClient(supabaseUrl, supabaseKey);

// 2. Lógica del formulario
const form = document.getElementById('transaccionForm');

form.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    // Captura de valores
    const concepto = document.getElementById('concepto').value;
    const monto = document.getElementById('monto').value;
    const tipo = document.getElementById('tipo').value;
    
    // Inserción en base de datos
    const { data, error } = await supabase
        .from('transacciones')
        .insert([{
            concepto: concepto,
            monto: monto,
            tipo: tipo,
            categoria_id: 1 // Asegúrate de que este valor exista en tu tabla o sea NULL
        }]);

    if (error) {
        console.error('Error detallado:', error);
        alert('Error al guardar: ' + error.message);
    } else {
        alert('Transacción guardada exitosamente');
        form.reset();
    }
});