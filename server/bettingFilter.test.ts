/**
 * Filtre des réponses IA du Labo paris (server/bettingFilter.ts), sans réseau : liste de domaines autorisés,
 * correspondance exacte du domaine ou sous-domaine, sources des redirections Google, texte libre (formes françaises et
 * anglaises des probabilités, cotes, mises et liens) et textes légitimes qui doivent passer.
 */
import { describe, expect, it } from 'vitest';
import { NEWS_ALLOWED_DOMAINS, TEXT_REMOVED, betTextViolations, filterSources, freeTextOk, guardFreeText, guardNewsText, hostAllowed, sourceAllowed, urlAllowed } from './bettingFilter';

describe('domaines autorisés', () => {
  it('liste bornée, noms d\'hôte simples, sans doublon, sans bookmaker ni site de pronostics', () => {
    expect(NEWS_ALLOWED_DOMAINS.length).toBeGreaterThan(20);
    expect(NEWS_ALLOWED_DOMAINS.length).toBeLessThanOrEqual(64);                 // limite des outils d'Anthropic
    expect(new Set(NEWS_ALLOWED_DOMAINS).size).toBe(NEWS_ALLOWED_DOMAINS.length);
    for (const d of NEWS_ALLOWED_DOMAINS) {
      expect(d).toMatch(/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/);                      // ni schéma, ni chemin, ni joker, ni port
      expect(d).not.toMatch(/^www\./);
      expect(d).not.toMatch(/bet|bwin|winamax|unibet|pmu|pinnacle|prono|tipst|odds|cote|casino|poker/);
    }
    expect(NEWS_ALLOWED_DOMAINS).toEqual(expect.arrayContaining(['uefa.com', 'lequipe.fr', 'bbc.co.uk']));
  });

  it('domaine exact ou sous-domaine seulement, jamais un suffixe de chaîne', () => {
    expect(hostAllowed('lequipe.fr')).toBe(true);
    expect(hostAllowed('www.lequipe.fr')).toBe(true);
    expect(hostAllowed('WWW.LEQUIPE.FR.')).toBe(true);
    expect(hostAllowed('evil-lequipe.fr')).toBe(false);
    expect(hostAllowed('evillequipe.fr')).toBe(false);
    expect(hostAllowed('lequipe.fr.evil.test')).toBe(false);
    expect(hostAllowed('as.com')).toBe(true);
    expect(hostAllowed('pas.com')).toBe(false);
    expect(hostAllowed('')).toBe(false);
    expect(hostAllowed(undefined)).toBe(false);
  });

  it('adresses : https sans identifiants ni port', () => {
    expect(urlAllowed('https://www.lequipe.fr/Football/article')).toBe(true);
    expect(urlAllowed('http://www.lequipe.fr/Football/article')).toBe(false);
    expect(urlAllowed('https://user:pw@www.lequipe.fr/')).toBe(false);
    expect(urlAllowed('https://www.lequipe.fr:8443/')).toBe(false);
    expect(urlAllowed('https://lequipe.fr@evil.test/')).toBe(false);
    expect(urlAllowed('javascript:alert(1)')).toBe(false);
    expect(urlAllowed('pas une adresse')).toBe(false);
  });

  it('redirections Google : gardées seulement si l\'éditeur déclaré est autorisé', () => {
    const grounding = 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/AbC123';
    expect(sourceAllowed({ title: 'lequipe.fr', uri: grounding, domain: 'lequipe.fr' })).toBe(true);
    expect(sourceAllowed({ title: 'evil.test', uri: grounding, domain: 'evil.test' })).toBe(false);
    expect(sourceAllowed({ title: 'lequipe.fr', uri: grounding })).toBe(false);
    expect(sourceAllowed({ title: 'x', uri: 'https://news.google.com/rss/articles/CBMi?oc=5', domain: 'www.bbc.co.uk' })).toBe(true);
    expect(sourceAllowed({ title: 'x', uri: 'https://news.google.com/search?q=x', domain: 'www.bbc.co.uk' })).toBe(false);
    expect(sourceAllowed({ title: 'x', uri: 'https://evil.test/r', domain: 'lequipe.fr' })).toBe(false);   // domaine déclaré sans redirection Google
  });

  it('filtre les sources et remplace un titre qui porte un chiffre de pari par le domaine', () => {
    const out = filterSources([
      { title: 'Club A : le point', uri: 'https://www.lequipe.fr/a' },
      { title: 'Pronostic', uri: 'https://evil-lequipe.fr/a' },
      { title: 'Misez 50 % @2.10', uri: 'https://www.bbc.co.uk/sport/b' },
    ]);
    expect(out.removed).toBe(1);
    expect(out.sources).toEqual([{ title: 'Club A : le point', uri: 'https://www.lequipe.fr/a' }, { title: 'bbc.co.uk', uri: 'https://www.bbc.co.uk/sport/b' }]);
  });
});

describe('texte libre', () => {
  const REJECTED: [string, string][] = [
    ['lien', 'Voir https://pronos.test/club-a pour le détail.'],
    ['lien', 'Voir http://pronos.test'],
    ['lien', 'Détails sur www.pronos.test'],
    ['lien', 'Détails sur [ce site](https://pronos.test).'],
    ['lien', 'Le site pronos-gagnants.bet le confirme.'],
    ['lien', 'Source : lequipe.fr'],
    ['pourcentage', 'Club A gagne dans 80 % des cas.'],
    ['pourcentage', 'Club A gagne dans 80% des cas.'],
    ['pourcentage', 'Win probability at 80 percent.'],
    ['pourcentage', 'Quatre-vingts pour cent de chances.'],
    ['pourcentage', 'Club A à ８０％.'],
    ['decimal', 'Probabilité 0,8 selon le marché.'],
    ['decimal', 'Une cote 2,10 intéressante.'],
    ['decimal', 'Jouable @2.10 chez le bookmaker.'],
    ['decimal', 'Club A à 2.10 ce soir.'],
    ['decimal', 'Deux virgule dix.'],
    ['fraction', 'Club A est à 5/2.'],
    ['fraction', 'Huit chances sur dix : 8 chances sur 10.'],
    ['fraction', 'Donné à 3 contre 1.'],
    ['cote', 'Cote de 3 pour Club A.'],
    ['cote', 'Odds of 3 on Club A.'],
    ['cote', 'Prenez-le @3.'],
    ['probabilite', 'Probabilité estimée : 7 sur 10 selon nous, soit 7 chances.'],
    ['probabilite', 'Club A has 3 chances in our model.'],
    ['mise', 'Misez gros sur Club A.'],
    ['mise', 'Pariez sur Club A.'],
    ['mise', 'Mise de 5 sur Club A.'],
    ['mise', 'Stake 5 units on Club A.'],
    ['mise', 'Une mise de deux unités.'],
    ['mise', 'Jouez 2u sur Club A.'],
    ['mise', 'Toute la bankroll sur Club A.'],
    ['mise', 'Placer 10 € sur Club A.'],
    ['mise', 'Placer dix euros sur Club A.'],
    ['mise', 'Doublez la mise sur Club A.'],
    ['mise', 'Kelly complet sur Club A.'],
    ['mise', 'mi​sez sur Club A.'],
  ];
  for (const [rule, text] of REJECTED) {
    it(`rejette (${rule}) : ${text}`, () => {
      expect(betTextViolations(text)).toContain(rule);
      expect(guardFreeText(text)).toEqual({ text: TEXT_REMOVED, rejected: true });
    });
  }

  const KEPT = [
    'Club B : attaquant suspendu (3 matchs).',
    'Club A : Buteur A forfait, absent 2 semaines, retour prévu le 21 novembre.',
    'Victoire 2-1 de Club A au match aller ; Joueur 1 est sorti à la 60e minute.',
    'Composition probable en 4-3-3, Club A est 3e du classement.',
    'Rotation probable avant le match de coupe dans 3 jours.',
    'Aucune information fiable trouvée.',
    'Les mises restent celles du moteur.',
    'Rien dans l\'actualité ne contredit la sélection. Le capitaine est confirmé.',
    TEXT_REMOVED,
  ];
  for (const text of KEPT) {
    it(`garde : ${text}`, () => {
      expect(betTextViolations(text)).toEqual([]);
      expect(freeTextOk(text)).toBe(true);
      expect(guardFreeText(text)).toEqual({ text, rejected: false });
    });
  }

  it('actualité : une puce fautive est remplacée par la mention, les autres restent ; idempotent', () => {
    const first = guardNewsText('- Club B : attaquant suspendu (3 matchs).\n- Probabilité 80 %, cote 2,10.\n- Club A : effectif complet.');
    expect(first).toEqual({ text: `- Club B : attaquant suspendu (3 matchs).\n- ${TEXT_REMOVED}\n- Club A : effectif complet.`, removed: 1 });
    expect(guardNewsText(first.text)).toEqual({ text: first.text, removed: 0 });
  });

  it('valeurs non textuelles : vides, jamais rejetées', () => {
    expect(guardFreeText(undefined)).toEqual({ text: '', rejected: false });
    expect(guardFreeText(42)).toEqual({ text: '', rejected: false });
    expect(betTextViolations('')).toEqual([]);
  });
});
