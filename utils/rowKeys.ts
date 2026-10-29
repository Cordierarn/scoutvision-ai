/**
 * ScoutVision - activation au clavier d'une ligne de tableau cliquable
 *
 * Entrée ou Espace ouvrent la ligne seulement quand la ligne elle-même a le focus :
 * une touche pressée sur un bouton de la ligne (étoile, voir la fiche, décomposition)
 * appartient à ce bouton et ne doit pas ouvrir la fiche.
 */

interface KeyLike {
  key: string;
  target: EventTarget | null;
  currentTarget: EventTarget | null;
}

export function isRowActivation(e: KeyLike): boolean {
  return e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ');
}
