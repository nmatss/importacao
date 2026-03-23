const XLSX = require('xlsx');
const wb = XLSX.readFile(
  '/mnt/c/Users/nic20/OneDrive/Área de Trabalho/1_Follow Up Processos de Importação.xlsx',
);
const ws = wb.Sheets[wb.SheetNames[0]];
const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
const withData = data.filter((r, i) => i > 0 && r[0] && String(r[0]).trim());
console.log('Total rows with process code:', withData.length);
const statuses = {};
withData.forEach((r) => {
  const s = String(r[1] || '').trim();
  statuses[s] = (statuses[s] || 0) + 1;
});
Object.entries(statuses)
  .sort((a, b) => b[1] - a[1])
  .forEach(([s, c]) => console.log('  ', c, ':', s));
const active = withData.filter((r) => {
  const st = String(r[1]).toLowerCase();
  return st.indexOf('encerrado') === -1;
});
console.log('\nActive (non-Encerrado):', active.length);
active.slice(0, 15).forEach((r) => console.log('  ', r[0], '|', r[1], '|', r[3], '| USD', r[17]));
