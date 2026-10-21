// Les courbes d'animation d'Ondine, en un seul endroit (les mêmes que les
// variables de src/styles/motion-tokens.css, pour le CSS).
//
// Pourquoi si peu ? Avec vingt courbes « presque pareilles » écrites à la main,
// on ne peut plus régler le ressenti de l'appli d'un coup. Quatre suffisent :
//   - EASE_OUT : tout ce qui arrive ou s'en va. Part vite, se pose
//     doucement : l'œil voit la réaction tout de suite (jamais d'ease-in, qui
//     démarre lentement au moment précis où l'on regarde) ;
//   - IOS : les grands mouvements (pages des Réglages, tiroirs), la courbe
//     des tiroirs d'iOS ;
//   - POP : un rebond franc, pour les petits moments de plaisir (une pastille
//     qui apparaît, une gomme qui se pose) ;
//   - POP_SOFT : un rebond léger, pour ce qui revient souvent.

export const EASE_OUT = "cubic-bezier(0.23, 1, 0.32, 1)";
export const IOS = "cubic-bezier(0.32, 0.72, 0, 1)";
export const POP = "cubic-bezier(0.34, 1.56, 0.64, 1)";
export const POP_SOFT = "cubic-bezier(0.34, 1.36, 0.64, 1)";
