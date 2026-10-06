// Les services communs, partagés par l'île et par tous les modules.
//
// - log         : le journal (fichier dans %LOCALAPPDATA%, rotation, niveaux)
// - settings    : les réglages (fichier JSON versionné, import/export)
// - credentials : les clés dans le Gestionnaire d'identifiants Windows
// - bus         : le bus d'événements côté Rust, relié à celui du front
// - undo        : les actions annulables pendant quelques secondes
// - privacy     : validation des chemins et dossiers exclus
// - files       : copier, déplacer, Corbeille, zip, presse-papiers (sans jamais écraser)
// - ics         : lecture des fichiers d'agenda .ics (rien n'est téléchargé)
// - ics_calendars : la liste des calendriers de l'Agenda, sa migration, la fusion

pub mod bus;
pub mod credentials;
pub mod files;
pub mod ics;
pub mod ics_calendars;
pub mod log;
pub mod privacy;
pub mod settings;
pub mod undo;
