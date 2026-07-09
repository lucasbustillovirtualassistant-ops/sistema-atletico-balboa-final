// La librería global se llama 'supabase' directamente
const supabase = supabase.createClient(
    'https://nhrncnxtwcwdybptiirr.supabase.co', 
    'TU_CLAVE_PUBLICA_AQUI'
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