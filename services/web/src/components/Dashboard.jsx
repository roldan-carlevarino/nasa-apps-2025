import { Bar } from 'react-chartjs-2';
import 'chart.js/auto';

export default function Dashboard({ data }) {
  if (!data || !Array.isArray(data) || data.length === 0) {
    return <div className="my-8 text-center text-gray-500 text-lg">No hay datos disponibles para mostrar.</div>;
  }

  // Filtramos valores válidos: solo números
  const labels = [];
  const pm25 = [];
  const ozono = [];

  data.forEach(d => {
    if (d.municipio && typeof d.pm25 === 'number' && typeof d.ozono === 'number') {
      labels.push(d.municipio);
      pm25.push(d.pm25);
      ozono.push(d.ozono);
    }
  });

  if (labels.length === 0) {
    return <div className="my-8 text-center text-gray-500 text-lg">No hay datos válidos para mostrar.</div>;
  }

  const chartData = {
    labels,
    datasets: [
      { label: 'PM2.5', data: pm25, backgroundColor: 'rgba(255,99,132,0.7)', borderRadius: 6 },
      { label: 'Ozono', data: ozono, backgroundColor: 'rgba(54,162,235,0.7)', borderRadius: 6 }
    ]
  };

  return (
    <div className="my-4 bg-blue-50 rounded-lg p-6 shadow">
      <h2 className="text-xl font-bold mb-4 text-blue-800">Comparativa de Indicadores</h2>
      <Bar data={chartData} options={{
        plugins: {
          legend: { labels: { color: '#1e3a8a', font: { size: 16, weight: 'bold' } } }
        },
        scales: {
          x: { ticks: { color: '#1e3a8a', font: { size: 14 } } },
          y: { ticks: { color: '#1e3a8a', font: { size: 14 } } }
        }
      }} />
    </div>
  );
}
