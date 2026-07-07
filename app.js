// Estas líneas leen las variables que acabas de configurar en Vercel
const supabaseUrl = process.env.SUPABASE_URL; 
const supabaseKey = process.env.SUPABASE_KEY;

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