// Configuración de Supabase
const supabaseUrl = 'https://nhrncnxtwcwdybptiirr.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5ocm5jbnh0d2N3ZHlicHRpaXJyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE4MDU3NDcsImV4cCI6MjA5NzM4MTc0N30.GDUZyAxlFAga8j9GHlocodS_NrMKzjQEHc8FdO0AkjM';
const supabase = supabaseClient.createClient(supabaseUrl, supabaseKey);

const form = document.getElementById('transaccionForm');

form.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const { data, error } = await supabase
        .from('transacciones')
        .insert([{
            concepto: document.getElementById('concepto').value,
            monto: document.getElementById('monto').value,
            tipo: document.getElementById('tipo').value,
            categoria_id: 1 // Por ahora fijo
        }]);

    if (error) {
        alert('Error al guardar: ' + error.message);
    } else {
        alert('Transacción guardada exitosamente');
        form.reset();
    }
});