import { PlayerData } from '../types';

/**
 * Export players data to CSV file
 */
export function exportToCSV(
  players: PlayerData[], 
  filename: string = 'players_export',
  columns?: string[]
): void {
  if (players.length === 0) {
    alert('Aucun joueur à exporter');
    return;
  }

  // Determine columns to export
  const headers = columns || Object.keys(players[0]);
  
  // Build CSV content
  const csvRows: string[] = [];
  
  // Header row
  csvRows.push(headers.map(h => `"${h}"`).join(','));
  
  // Data rows
  players.forEach(player => {
    const row = headers.map(header => {
      const value = player[header];
      if (value === null || value === undefined) return '';
      if (typeof value === 'string') return `"${value.replace(/"/g, '""')}"`;
      return String(value);
    });
    csvRows.push(row.join(','));
  });

  const csvContent = csvRows.join('\n');
  
  // Create and download file
  const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${filename}_${new Date().toISOString().split('T')[0]}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Export du Chasseur de pépites : rang, rôle et indice du rôle, puis les colonnes habituelles
 * et les critères éliminatoires du rôle
 */
export function exportProspects(
  rows: { player: PlayerData; rank: number; index: number }[],
  roleName: string,
  metricColumns: string[]
): void {
  const baseColumns = ['Player', 'Team', 'Position', 'Age', 'Minutes played', 'Market value', 'League'];
  const columns = ['Rang', 'Rôle', 'Indice du rôle', ...baseColumns, ...metricColumns];
  const records = rows.map(({ player, rank, index }) => ({ ...player, 'Rang': rank, 'Rôle': roleName, 'Indice du rôle': index } as PlayerData));
  const sanitizedRole = roleName.replace(/[^a-zA-Z0-9]/g, '_');
  exportToCSV(records, `prospects_${sanitizedRole}`, columns);
}
