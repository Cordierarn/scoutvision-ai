/** Rendu statique des filtres qualitatifs (joueurs et clubs fictifs) */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ProfileFiltersPanel, ProfileOptions } from './ProfileFiltersPanel';
import { EMPTY_PROFILE } from '../../utils/profileFilters';

const options: ProfileOptions = {
  competitions: [{ value: 'AAA', label: 'Ligue A', hint: 'niveau 1' }], tiers: [1, 2],
  teams: [{ value: 't1', label: 'Club A' }], nations: [{ value: 'FRA', label: 'France' }],
  competitionName: k => k, teamName: id => (id === 't1' ? 'Club A' : 'Club absent de cette saison'),
};
const render = (value = EMPTY_PROFILE, missing = { nation: 0, foot: 0, height: 0 }) =>
  renderToStaticMarkup(<ProfileFiltersPanel value={value} onChange={() => {}} options={options} missing={missing} />);

describe('ProfileFiltersPanel', () => {
  it('combobox accessibles et boutons à bascule', () => {
    const html = render();
    expect(html.match(/role="combobox"/g)).toHaveLength(3);
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-controls=');
    expect(html).toContain('aria-pressed="false"');
    for (const t of ['Compétitions', 'Niveau', 'Clubs (saison chargée)', 'Nationalités', 'Pied fort', 'Taille (cm)']) expect(html).toContain(t);
  });

  it('nombre de joueurs écartés faute de donnée, avec l\'option de les inclure', () => {
    const html = render({ ...EMPTY_PROFILE, feet: ['Left'] }, { nation: 0, foot: 312, height: 0 });
    expect(html).toContain('aria-pressed="true"');
    expect(html).toMatch(/312<\/span> joueurs sans pied renseigné : inclure/);
    const inc = render({ ...EMPTY_PROFILE, feet: ['Left'], includeMissing: { nation: false, foot: true, height: false } }, { nation: 0, foot: 312, height: 0 });
    expect(inc).toMatch(/sans pied renseigné : inclus/);
  });

  it('puces retirables et club absent de la saison chargée', () => {
    const html = render({ ...EMPTY_PROFILE, teams: ['t1', 't9'], nations: ['FRA'] });
    expect(html).toContain('aria-label="Retirer Club A"');
    expect(html).toContain('aria-label="Retirer Club absent de cette saison"');
    expect(html).toContain('aria-label="Retirer France"');
    expect(html).toContain('+ UE (27)');
  });
});
