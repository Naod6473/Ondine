// L'île s'écarte d'une fenêtre : le calcul, sans Tauri ni Windows (testé).
//
// On donne l'écran, la taille de l'île (sa longueur le long du bord et son
// épaisseur), sa place réglée (« maison »), sa place actuelle, et les
// rectangles à éviter (la fenêtre de réglages, une fenêtre au premier plan,
// une bulle de Windows…). La réponse : la place où aller.
//
//   1. La maison est libre : on y reste (ou on y revient).
//   2. Sinon, elle glisse le long de SON bord jusqu'à sortir de la zone (le
//      côté le plus proche de sa place actuelle).
//   3. Bord entièrement couvert : elle saute sur le bord libre le plus proche.
//   4. Plus aucune place libre : elle se cale dans le coin le plus loin des
//      fenêtres, « acculée » (l'appelant la fait trembler).
//
// Toutes les mesures sont en px logiques, depuis le coin haut gauche de l'écran.

use super::{Placement, PANEL_W, SIDE_PANEL_H};

/// La marge gardée entre l'île et une fenêtre à éviter (px logiques).
pub const MARGIN: f64 = 16.0;

/// Un rectangle (px logiques, depuis le coin de l'écran).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

impl Rect {
    pub fn grow(&self, m: f64) -> Rect {
        Rect { x: self.x - m, y: self.y - m, w: self.w + 2.0 * m, h: self.h + 2.0 * m }
    }

    pub fn overlaps(&self, o: &Rect) -> bool {
        self.x < o.x + o.w && o.x < self.x + self.w && self.y < o.y + o.h && o.y < self.y + self.h
    }

    fn center(&self) -> (f64, f64) {
        (self.x + self.w / 2.0, self.y + self.h / 2.0)
    }
}

/// L'écran : largeur, hauteur, et le bas de la zone de travail (au-dessus de la
/// barre des tâches, là où se pose l'île du bas).
#[derive(Clone, Copy, Debug)]
pub struct Screen {
    pub w: f64,
    pub h: f64,
    pub bottom: f64,
}

/// La taille de l'île couchée le long d'un bord horizontal : `len` × `thick`
/// (sur un côté, les deux sont échangées).
#[derive(Clone, Copy, Debug)]
pub struct Size {
    pub len: f64,
    pub thick: f64,
}

/// La réponse : où aller, et si elle est acculée (plus aucune place libre).
#[derive(Clone, Debug, PartialEq)]
pub struct Escape {
    pub place: Placement,
    pub cornered: bool,
}

fn side(edge: &str) -> bool {
    edge == "left" || edge == "right"
}

/// La longueur du bord, et celle de la fenêtre de l'île le long de ce bord
/// (la fenêtre est centrée sur `offset` sans sortir de l'écran, voir `frame_in`).
fn edge_len(s: &Screen, edge: &str) -> (f64, f64) {
    if side(edge) {
        (s.h, SIDE_PANEL_H)
    } else {
        (s.w, PANEL_W)
    }
}

/// Le rectangle de l'île à cette place.
pub fn island_rect(s: &Screen, size: Size, p: &Placement) -> Rect {
    let (len, win) = edge_len(s, &p.edge);
    let (l, t) = (size.len.min(len), size.thick);
    // Le début de l'île le long du bord.
    let a = match p.align.as_str() {
        "start" => 0.0,
        "end" => len - l,
        _ => {
            let half = (win.min(len)) / 2.0;
            (p.offset * len).clamp(half, len - half) - l / 2.0
        }
    };
    match p.edge.as_str() {
        "left" => Rect { x: 0.0, y: a, w: t, h: l },
        "right" => Rect { x: s.w - t, y: a, w: t, h: l },
        "bottom" => Rect { x: a, y: s.bottom - t, w: l, h: t },
        _ => Rect { x: a, y: 0.0, w: l, h: t },
    }
}

fn free(s: &Screen, size: Size, p: &Placement, walls: &[Rect]) -> bool {
    let r = island_rect(s, size, p);
    !walls.iter().any(|w| w.overlaps(&r))
}

fn place(edge: &str, align: &str, offset: f64) -> Placement {
    Placement { edge: edge.into(), align: align.into(), offset }
}

/// Les places à essayer sur un bord : les deux coins, le centre, la même
/// position que la maison, et juste avant / juste après chaque fenêtre.
fn candidates(s: &Screen, size: Size, edge: &str, home: &Placement, walls: &[Rect]) -> Vec<Placement> {
    let (len, _) = edge_len(s, edge);
    let l = size.len;
    let mut out = vec![place(edge, "start", 0.0), place(edge, "end", 1.0), place(edge, "center", 0.5)];
    if home.align == "center" {
        out.push(place(edge, "center", home.offset));
    }
    for w in walls {
        let (a0, a1) = if side(edge) { (w.y, w.y + w.h) } else { (w.x, w.x + w.w) };
        for c in [a0 - l / 2.0, a1 + l / 2.0] {
            if c > 0.0 && c < len {
                out.push(place(edge, "center", c / len));
            }
        }
    }
    out
}

fn dist(a: (f64, f64), b: (f64, f64)) -> f64 {
    (a.0 - b.0).hypot(a.1 - b.1)
}

/// La place où aller pour ne recouvrir aucun des rectangles `obstacles`
/// (agrandis de `margin`). `home` : la place réglée ; `current` : la place
/// actuelle (pour bouger le moins possible).
pub fn escape(s: &Screen, size: Size, home: &Placement, current: &Placement, obstacles: &[Rect], margin: f64) -> Escape {
    let walls: Vec<Rect> = obstacles.iter().map(|o| o.grow(margin)).collect();
    if free(s, size, home, &walls) {
        return Escape { place: home.clone(), cornered: false };
    }
    let here = island_rect(s, size, current).center();
    let nearest = |list: Vec<Placement>| -> Option<Placement> {
        list.into_iter()
            .filter(|p| free(s, size, p, &walls))
            .min_by(|a, b| {
                let da = dist(island_rect(s, size, a).center(), here);
                let db = dist(island_rect(s, size, b).center(), here);
                da.total_cmp(&db)
            })
    };
    // 2. Glisser le long de son bord.
    if let Some(p) = nearest(candidates(s, size, &home.edge, home, &walls)) {
        return Escape { place: p, cornered: false };
    }
    // 3. Le bord libre le plus proche.
    let others: Vec<Placement> = ["top", "bottom", "left", "right"]
        .iter()
        .filter(|e| **e != home.edge)
        .flat_map(|e| candidates(s, size, e, home, &walls))
        .collect();
    if let Some(p) = nearest(others) {
        return Escape { place: p, cornered: false };
    }
    // 4. Acculée : le coin le plus loin des fenêtres (de leur centre commun).
    let n = walls.len().max(1) as f64;
    let threat = walls.iter().fold((0.0, 0.0), |acc, w| {
        let c = w.center();
        (acc.0 + c.0 / n, acc.1 + c.1 / n)
    });
    let corners = ["top", "bottom", "left", "right"]
        .iter()
        .flat_map(|e| [place(e, "start", 0.0), place(e, "end", 1.0)])
        .max_by(|a, b| {
            let da = dist(island_rect(s, size, a).center(), threat);
            let db = dist(island_rect(s, size, b).center(), threat);
            // À égalité, le coin du bord de la maison.
            da.total_cmp(&db).then_with(|| (a.edge == home.edge).cmp(&(b.edge == home.edge)))
        })
        .unwrap_or_else(|| home.clone());
    Escape { place: corners, cornered: true }
}

#[cfg(test)]
mod tests {
    use super::*;

    const S: Screen = Screen { w: 1920.0, h: 1080.0, bottom: 1032.0 };
    const MINI: Size = Size { len: 340.0, thick: 44.0 };

    fn p(edge: &str, align: &str, offset: f64) -> Placement {
        place(edge, align, offset)
    }

    /// La fenêtre de réglages, 760 × 720, au centre de l'écran.
    fn settings_at(x: f64, y: f64) -> Rect {
        Rect { x, y, w: 760.0, h: 720.0 }
    }

    #[test]
    fn stays_home_when_nothing_overlaps() {
        let home = p("top", "center", 0.5);
        // Réglages au centre : elle ne touche pas l'île du haut (y = 180).
        let e = escape(&S, MINI, &home, &home, &[settings_at(580.0, 180.0)], MARGIN);
        assert_eq!(e, Escape { place: home.clone(), cornered: false });
        // Aucune fenêtre : la maison.
        assert_eq!(escape(&S, MINI, &home, &p("left", "start", 0.0), &[], MARGIN).place, home);
    }

    #[test]
    fn slides_along_its_edge_to_the_nearest_free_side() {
        let home = p("top", "center", 0.5);
        // Réglages collés en haut, un peu à gauche du centre : l'île file à droite.
        let w = settings_at(500.0, 0.0);
        let e = escape(&S, MINI, &home, &home, &[w], MARGIN);
        assert!(!e.cornered);
        assert_eq!(e.place.edge, "top");
        let r = island_rect(&S, MINI, &e.place);
        assert!(!w.grow(MARGIN).overlaps(&r));
        assert!(r.x >= 500.0 + 760.0, "à droite de la fenêtre : {r:?}");
        // Poussée plus à droite : elle passe de l'autre côté seulement si c'est plus près.
        let e2 = escape(&S, MINI, &home, &e.place, &[settings_at(1000.0, 0.0)], MARGIN);
        let r2 = island_rect(&S, MINI, &e2.place);
        assert_eq!(e2.place.edge, "top");
        assert!(r2.x + r2.w <= 1000.0 - MARGIN, "à gauche : {r2:?}");
    }

    #[test]
    fn jumps_to_the_nearest_free_edge_when_its_edge_is_covered() {
        // Une fenêtre qui couvre tout le haut de l'écran.
        let home = p("top", "center", 0.5);
        let wide = Rect { x: 0.0, y: 0.0, w: 1920.0, h: 300.0 };
        let e = escape(&S, MINI, &home, &home, &[wide], MARGIN);
        assert!(!e.cornered);
        assert_ne!(e.place.edge, "top");
        assert!(!wide.grow(MARGIN).overlaps(&island_rect(&S, MINI, &e.place)));
        // Le bas aussi : un côté, sous la fenêtre.
        let home = p("bottom", "center", 0.5);
        let low = Rect { x: 0.0, y: 700.0, w: 1920.0, h: 380.0 };
        let e = escape(&S, MINI, &home, &home, &[low], MARGIN);
        assert!(matches!(e.place.edge.as_str(), "left" | "right" | "top"), "{e:?}");
        assert!(!low.grow(MARGIN).overlaps(&island_rect(&S, MINI, &e.place)));
    }

    #[test]
    fn cornered_goes_to_the_farthest_corner() {
        // Une fenêtre presque plein écran, décalée vers le haut à gauche.
        let home = p("top", "center", 0.5);
        let big = Rect { x: 0.0, y: 0.0, w: 1900.0, h: 1000.0 };
        let e = escape(&S, MINI, &home, &home, &[big], MARGIN);
        assert!(e.cornered);
        let r = island_rect(&S, MINI, &e.place);
        // Le coin bas droit (au bout du bord droit).
        assert!(r.x + r.w >= 1919.0 && r.y + r.h >= S.bottom - 1.0, "{e:?} {r:?}");
        assert_eq!((e.place.edge.as_str(), e.place.align.as_str()), ("right", "end"));
    }

    #[test]
    fn side_and_bottom_rects() {
        let r = island_rect(&S, MINI, &p("left", "start", 0.0));
        assert_eq!(r, Rect { x: 0.0, y: 0.0, w: 44.0, h: 340.0 });
        let r = island_rect(&S, MINI, &p("bottom", "end", 1.0));
        assert_eq!(r, Rect { x: 1920.0 - 340.0, y: 1032.0 - 44.0, w: 340.0, h: 44.0 });
        // Centre : la fenêtre (720 px) ne sort pas de l'écran, l'île non plus.
        let r = island_rect(&S, MINI, &p("top", "center", 0.0));
        assert_eq!(r.x, 360.0 - 170.0);
    }
}
