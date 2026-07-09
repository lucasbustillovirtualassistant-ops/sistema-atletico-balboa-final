// Inicialización segura y única
const supabase = supabaseClient.createClient(
    'https://nhrncnxtwcwdybptiirr.supabase.co', 
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5ocm5jbnh0d2N3ZHlicHRpaXJyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE4MDU3NDcsImV4cCI6MjA5NzM4MTc0N30.GDUZyAxlFAga8j9GHlocodS_NrMKzjQEHc8FdO0AkjM'
);

// Lógica del formulario
document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('transaccionForm');
    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const { data, error } = await supabase.from('transacciones').insert([{
                fecha: document.getElementById('fecha').value,
                concepto: document.getElementById('concepto').value,
                monto: document.getElementById('monto').value,
                tipo: document.getElementById('tipo').value,
                categoria_id: 1
            }]);
            
            if (error) alert('Error: ' + error.message);
            else { alert('¡Guardado!'); form.reset(); }
        });
    }
});