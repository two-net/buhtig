//! Preview cards (FR-NAV-07): a picture of a dashboard's resource, its name, its description
//! and its figures, for chat tools to show beside a link to the dashboard (FR-NAV-06) and for
//! READMEs to embed. [`crate::preview`] tells what a card shows. This draws it, as SVG, and
//! as PNG for chat tools, which take no SVG.
//!
//! A card is drawn in BuhTig's light colors (src/styles.css in the UI), with presentation
//! attributes alone, no style sheet and nothing from elsewhere, so that the Content Security
//! Policy holds when it is opened on its own (NFR-SEC-06), and so that an `<img>` shows it as
//! it is. Its text comes from GitHub, so it is escaped (NFR-SEC-03).

use std::sync::{Arc, LazyLock};

use resvg::tiny_skia::{Pixmap, Transform};
use resvg::usvg;
use tokio::sync::Semaphore;

/// How wide and tall a card is drawn, which is what chat tools ask of an image: 1.91 to 1.
pub const WIDTH: u32 = 1200;
pub const HEIGHT: u32 = 630;

/// The size an SVG card is shown at where nothing else says, such as in a README: half its
/// drawing's, so that its text reads as a page's.
const SHOWN_WIDTH: u32 = WIDTH / 2;
const SHOWN_HEIGHT: u32 = HEIGHT / 2;

/// The margin around what a card shows, and the width of what is within it.
const PAD: f64 = 64.0;
const INNER: f64 = WIDTH as f64 - 2.0 * PAD;

// BuhTig's light theme (src/styles.css).
const BG: &str = "#ffffff";
const FG: &str = "#1f2328";
const FG_MUTED: &str = "#59636e";
const BORDER: &str = "#d1d9e0";
const ACCENT: &str = "#0969da";
/// The first color of charts, which a dashboard gives its first language too.
const SERIES: &str = "#2a78d6";

/// The UI's text, then the font that a PNG is drawn with, which the SVG falls back to.
const FONTS: &str =
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif";

/// Noto Sans, under the SIL Open Font License (fonts/OFL.txt), cut to Latin, Greek, Cyrillic
/// and punctuation: what a PNG card is drawn with. Other letters, such as CJK, and emoji, are
/// left out of a PNG, but not of an SVG, which the viewer's fonts draw.
const REGULAR: &[u8] = include_bytes!("../fonts/NotoSans-Regular.ttf");
const BOLD: &[u8] = include_bytes!("../fonts/NotoSans-Bold.ttf");
const FONT: &str = "Noto Sans";

/// How many PNG cards may be drawn at once. Each takes about 3 MB while it is, and a CPU, so
/// that others wait rather than crowd out the dashboards (NFR-CAP-01).
const DRAWING_AT_ONCE: usize = 2;

// What a card says (NFR-UX-07).

/// After a resource's name, in what a card says of itself to assistive technology.
pub const ON_BUHTIG: &str = "on BuhTig";

/// What a card says of a resource that BuhTig knows nothing fresh of.
pub const SEE_DASHBOARD: &str = "See its dashboard on BuhTig";

/// How many weeks of commits a repository's card shows.
const WEEKS: usize = 52;

fn stars(count: u64) -> &'static str {
    if count == 1 { "star" } else { "stars" }
}

fn forks(count: u64) -> &'static str {
    if count == 1 { "fork" } else { "forks" }
}

fn repositories(count: u64) -> &'static str {
    if count == 1 {
        "repository"
    } else {
        "repositories"
    }
}

fn commits(count: u64) -> String {
    let unit = if count == 1 { "commit" } else { "commits" };
    format!("{} {unit} in the last {WEEKS} weeks", grouped(count))
}

// BuhTig's icons (src/app/icon/icon.ts in the UI), strokes on a grid of 24.
const STAR: &str = "M12 3.6l2.6 5.3 5.8.85-4.2 4.1 1 5.8L12 16.9l-5.2 2.75 1-5.8-4.2-4.1 5.8-.85z";
const FORK: &str = "M4 5a2 2 0 1 0 4 0a2 2 0 1 0-4 0M16 5a2 2 0 1 0 4 0a2 2 0 1 0-4 0\
                    M10 19a2 2 0 1 0 4 0a2 2 0 1 0-4 0M6 7v1.5a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3V7\
                    M12 11.5V17";
const REPO: &str = "M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5zM5 19.5A1.5 1.5 0 0 0 \
                    6.5 21H19M9 7h6";

/// BuhTig's mark, the B of its wordmark on a circle of its accent, as its favicon draws it
/// (public/favicon.svg in the UI), on a grid of 32.
const MARK: &str = "M0 70V0H19.5A16 16 0 0 1 19.5 32H0M19.5 32H21.5A19 19 0 0 1 21.5 70H0";

/// A card: a resource's name, and what BuhTig knows of it, if anything.
#[derive(Clone, Debug, PartialEq)]
pub struct Card {
    /// `owner/repo`, or an account's login: as GitHub spells it, if the card knows it.
    pub name: String,
    /// What the shared cache holds, fresh, of the resource, or `None` if nothing.
    pub facts: Option<Facts>,
}

/// What a card tells of a resource.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Facts {
    /// On one line, at most so long ([`crate::preview`]).
    pub description: String,
    /// An account's repositories, and whether it has more than BuhTig reads (FR-ORG-08).
    pub repositories: Option<(u64, bool)>,
    pub stars: Option<u64>,
    pub forks: Option<u64>,
    pub language: Option<String>,
    /// A repository's commits each week, the oldest first, up to the last [`WEEKS`].
    pub activity: Option<Vec<u64>>,
}

impl Card {
    /// The card as SVG, with `host`, where BuhTig is reached, in its corner.
    pub fn svg(&self, host: &str) -> String {
        let mut svg = Svg::default();
        let label = self.label();
        svg.push(&format!(
            "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"{SHOWN_WIDTH}\" \
             height=\"{SHOWN_HEIGHT}\" viewBox=\"0 0 {WIDTH} {HEIGHT}\" role=\"img\" \
             aria-label=\"{label}\" font-family=\"{FONTS}\">",
            label = escape(&label),
        ));
        svg.push(&format!("<title>{}</title>", escape(&label)));
        svg.push(&format!(
            "<rect x=\"1\" y=\"1\" width=\"{}\" height=\"{}\" rx=\"24\" fill=\"{BG}\" \
             stroke=\"{BORDER}\" stroke-width=\"2\"/>",
            WIDTH - 2,
            HEIGHT - 2
        ));
        svg.brand(host);
        let top = svg.title(&self.name);
        match &self.facts {
            None => {
                svg.lines(&[SEE_DASHBOARD.to_owned()], top + 72.0, 32.0, FG_MUTED);
                svg.address(&format!("{host}/{}", self.name));
            }
            Some(facts) => {
                let lines = wrap(&facts.description, 30.0, INNER, 3);
                svg.lines(&lines, top + 64.0, 30.0, FG_MUTED);
                let activity = facts.weeks();
                svg.figures(facts, if activity.is_some() { 440.0 } else { 556.0 });
                if let Some(weeks) = activity {
                    svg.activity(weeks);
                }
            }
        }
        svg.push("</svg>");
        svg.0
    }

    /// What the card says, in a sentence, to assistive technology and as its title.
    fn label(&self) -> String {
        let mut label = format!("{} {ON_BUHTIG}", self.name);
        let Some(facts) = &self.facts else {
            return label;
        };
        if !facts.description.is_empty() {
            label.push_str(": ");
            label.push_str(&facts.description);
        }
        let mut figures = Vec::new();
        if let Some((count, more)) = facts.repositories {
            figures.push(format!(
                "{}{} {}",
                compact(count),
                if more { "+" } else { "" },
                repositories(count)
            ));
        }
        if let Some(count) = facts.stars {
            figures.push(format!("{} {}", compact(count), stars(count)));
        }
        if let Some(count) = facts.forks {
            figures.push(format!("{} {}", compact(count), forks(count)));
        }
        if let Some(language) = &facts.language {
            figures.push(language.clone());
        }
        if let Some(weeks) = facts.weeks() {
            figures.push(commits(weeks.iter().sum()));
        }
        if !figures.is_empty() {
            if !label.ends_with(['.', '!', '?', '…']) {
                label.push('.');
            }
            label.push(' ');
            label.push_str(&figures.join(", "));
            label.push('.');
        }
        label
    }
}

impl Facts {
    /// A repository's commits each week, the last [`WEEKS`] of them, if it tells any.
    fn weeks(&self) -> Option<&[u64]> {
        self.activity
            .as_deref()
            .map(|weeks| &weeks[weeks.len().saturating_sub(WEEKS)..])
            .filter(|weeks| !weeks.is_empty())
    }
}

/// An SVG card as it is drawn.
#[derive(Default)]
struct Svg(String);

impl Svg {
    fn push(&mut self, text: &str) {
        self.0.push_str(text);
    }

    /// BuhTig's mark and name in the top left corner, and `host` in the right.
    fn brand(&mut self, host: &str) {
        self.push(&format!(
            "<g transform=\"translate({PAD} 52)\"><circle cx=\"22\" cy=\"22\" r=\"22\" \
             fill=\"{ACCENT}\"/><path d=\"{MARK}\" transform=\"translate(16.5 11.9) scale(0.289)\" \
             fill=\"none\" stroke=\"{BG}\" stroke-width=\"16.5\" stroke-linecap=\"round\" \
             stroke-linejoin=\"round\"/></g>"
        ));
        self.push(&format!(
            "<text x=\"{}\" y=\"85\" font-size=\"30\" font-weight=\"700\" fill=\"{FG}\">BuhTig</text>",
            PAD + 58.0
        ));
        let host = clip(host, 24.0, false, INNER / 2.0);
        self.push(&format!(
            "<text x=\"{}\" y=\"84\" font-size=\"24\" fill=\"{FG_MUTED}\" \
             text-anchor=\"end\">{}</text>",
            PAD + INNER,
            escape(&host)
        ));
    }

    /// The resource's name, as large as fits, a repository's owner lighter than its name.
    /// Where its line ends.
    fn title(&mut self, name: &str) -> f64 {
        let size = [64.0, 56.0, 48.0, 40.0]
            .into_iter()
            .find(|size| width(name, *size, true) <= INNER)
            .unwrap_or(40.0);
        let y = 132.0 + size;
        let fits = width(name, size, true) <= INNER;
        match name.split_once('/') {
            Some((owner, repo)) if fits => self.push(&format!(
                "<text x=\"{PAD}\" y=\"{y}\" font-size=\"{size}\"><tspan fill=\"{FG_MUTED}\">{}/</tspan>\
                 <tspan fill=\"{FG}\" font-weight=\"700\">{}</tspan></text>",
                escape(owner),
                escape(repo)
            )),
            _ => self.push(&format!(
                "<text x=\"{PAD}\" y=\"{y}\" font-size=\"{size}\" font-weight=\"700\" \
                 fill=\"{FG}\">{}</text>",
                escape(&clip(name, size, true, INNER))
            )),
        }
        y
    }

    /// The address of the resource's dashboard along the bottom, in the color of links.
    fn address(&mut self, address: &str) {
        self.push(&format!(
            "<text x=\"{PAD}\" y=\"556\" font-size=\"30\" fill=\"{ACCENT}\">{}</text>",
            escape(&clip(address, 30.0, false, INNER))
        ));
    }

    /// `lines` of text, the first at `y`.
    fn lines(&mut self, lines: &[String], y: f64, size: f64, color: &str) {
        for (index, line) in lines.iter().enumerate() {
            self.push(&format!(
                "<text x=\"{PAD}\" y=\"{}\" font-size=\"{size}\" fill=\"{color}\">{}</text>",
                y + index as f64 * size * 1.4,
                escape(line)
            ));
        }
    }

    /// The figures in a row, at `y`: each with its icon and its unit in words, and the
    /// language with its dot, so that color alone tells nothing (NFR-UX-05).
    fn figures(&mut self, facts: &Facts, y: f64) {
        const SIZE: f64 = 30.0;
        let mut x = PAD;
        let mut figure = |svg: &mut Svg, icon: &str, value: String, unit: &str| {
            svg.push(&format!(
                "<path d=\"{icon}\" transform=\"translate({x} {}) scale(1.4)\" fill=\"none\" \
                 stroke=\"{FG_MUTED}\" stroke-width=\"1.7\" stroke-linecap=\"round\" \
                 stroke-linejoin=\"round\"/>",
                y - 27.0
            ));
            let text = x + 44.0;
            svg.push(&format!(
                "<text x=\"{text}\" y=\"{y}\" font-size=\"{SIZE}\"><tspan font-weight=\"700\" \
                 fill=\"{FG}\">{value}</tspan><tspan fill=\"{FG_MUTED}\"> {unit}</tspan></text>"
            ));
            x = text + width(&value, SIZE, true) + width(&format!(" {unit}"), SIZE, false) + 40.0;
        };
        if let Some((count, more)) = facts.repositories {
            let value = format!("{}{}", compact(count), if more { "+" } else { "" });
            figure(self, REPO, value, repositories(count));
        }
        if let Some(count) = facts.stars {
            figure(self, STAR, compact(count), stars(count));
        }
        if let Some(count) = facts.forks {
            figure(self, FORK, compact(count), forks(count));
        }
        if let Some(language) = &facts.language {
            let room = PAD + INNER - x - 30.0;
            if room > SIZE * 2.0 {
                self.push(&format!(
                    "<circle cx=\"{}\" cy=\"{}\" r=\"10\" fill=\"{SERIES}\"/>\
                     <text x=\"{}\" y=\"{y}\" font-size=\"{SIZE}\" fill=\"{FG}\">{}</text>",
                    x + 10.0,
                    y - 10.0,
                    x + 30.0,
                    escape(&clip(language, SIZE, false, room))
                ));
            }
        }
    }

    /// A repository's commits each week as a line along the bottom, with how many in words.
    fn activity(&mut self, weeks: &[u64]) {
        const TOP: f64 = 478.0;
        const BOTTOM: f64 = 552.0;
        let highest = weeks.iter().copied().max().unwrap_or(0).max(1) as f64;
        let step = INNER / (weeks.len().max(2) - 1) as f64;
        let points: Vec<String> = weeks
            .iter()
            .enumerate()
            .map(|(index, &count)| {
                let x = PAD + index as f64 * step;
                let y = BOTTOM - 2.0 - count as f64 / highest * (BOTTOM - TOP - 4.0);
                format!("{x:.1} {y:.1}")
            })
            .collect();
        let last = PAD + (weeks.len() - 1) as f64 * step;
        self.push(&format!(
            "<path d=\"M{PAD} {BOTTOM}L{}L{last:.1} {BOTTOM}Z\" fill=\"{SERIES}\" \
             fill-opacity=\"0.14\"/>",
            points.join("L")
        ));
        self.push(&format!(
            "<path d=\"M{}\" fill=\"none\" stroke=\"{SERIES}\" stroke-width=\"4\" \
             stroke-linecap=\"round\" stroke-linejoin=\"round\"/>",
            points.join("L")
        ));
        self.push(&format!(
            "<text x=\"{PAD}\" y=\"592\" font-size=\"24\" fill=\"{FG_MUTED}\">{}</text>",
            commits(weeks.iter().sum())
        ));
    }
}

/// `svg`, a card's, drawn as PNG, [`WIDTH`] by [`HEIGHT`], with the fonts BuhTig carries
/// alone. It waits while [`DRAWING_AT_ONCE`] others are drawn, and draws on a thread of its
/// own, so that the server goes on serving meanwhile.
pub async fn png(svg: String) -> Result<Vec<u8>, String> {
    static DRAWING: LazyLock<Arc<Semaphore>> =
        LazyLock::new(|| Arc::new(Semaphore::new(DRAWING_AT_ONCE)));
    let _permit = DRAWING
        .clone()
        .acquire_owned()
        .await
        .map_err(|error| error.to_string())?;
    tokio::task::spawn_blocking(move || draw(&svg))
        .await
        .map_err(|error| error.to_string())?
}

/// `svg` drawn as PNG, at once.
fn draw(svg: &str) -> Result<Vec<u8>, String> {
    static OPTIONS: LazyLock<usvg::Options<'static>> = LazyLock::new(|| {
        let mut options = usvg::Options {
            font_family: FONT.to_owned(),
            // A card has no images, and none shall be read from files or elsewhere.
            image_href_resolver: usvg::ImageHrefResolver {
                resolve_data: Box::new(|_, _, _| None),
                resolve_string: Box::new(|_, _| None),
            },
            ..usvg::Options::default()
        };
        let fonts = options.fontdb_mut();
        fonts.load_font_data(REGULAR.to_vec());
        fonts.load_font_data(BOLD.to_vec());
        fonts.set_sans_serif_family(FONT);
        options
    });
    let tree = usvg::Tree::from_str(svg, &OPTIONS).map_err(|error| error.to_string())?;
    let mut pixmap = Pixmap::new(WIDTH, HEIGHT).ok_or("a card has a size")?;
    let size = tree.size();
    let scale = Transform::from_scale(WIDTH as f32 / size.width(), HEIGHT as f32 / size.height());
    resvg::render(&tree, scale, &mut pixmap.as_mut());
    pixmap.encode_png().map_err(|error| error.to_string())
}

/// `text` as XML or HTML text or a value of an attribute in double quotes, without the
/// characters that XML takes in neither: control characters but tab and line breaks, and
/// U+FFFE and U+FFFF.
pub fn escape(text: &str) -> String {
    let mut escaped = String::with_capacity(text.len());
    for c in text.chars() {
        match c {
            '&' => escaped.push_str("&amp;"),
            '<' => escaped.push_str("&lt;"),
            '>' => escaped.push_str("&gt;"),
            '"' => escaped.push_str("&quot;"),
            '\'' => escaped.push_str("&#39;"),
            '\t' | '\n' | '\r' => escaped.push(c),
            c if c < ' ' || c == '\u{fffe}' || c == '\u{ffff}' => {}
            c => escaped.push(c),
        }
    }
    escaped
}

/// `count` as English shows it compactly, as the UI does in English (UI-06): 999, 1.2K,
/// 12.3K, 1M.
pub fn compact(count: u64) -> String {
    const UNITS: [(f64, &str); 4] = [(1e3, "K"), (1e6, "M"), (1e9, "B"), (1e12, "T")];
    let value = count as f64;
    let Some(mut unit) = UNITS.iter().rposition(|(size, _)| value >= *size) else {
        return count.to_string();
    };
    let mut tenths = (value / UNITS[unit].0 * 10.0).round();
    // As 999,999 is 1M rather than 1000K.
    if tenths >= 10_000.0 && unit + 1 < UNITS.len() {
        unit += 1;
        tenths = (value / UNITS[unit].0 * 10.0).round();
    }
    one_decimal(tenths, UNITS[unit].1)
}

fn one_decimal(tenths: f64, unit: &str) -> String {
    if tenths % 10.0 == 0.0 {
        format!("{}{unit}", tenths / 10.0)
    } else {
        format!("{:.1}{unit}", tenths / 10.0)
    }
}

/// `count` with its thousands apart, as English writes them: 1,234.
fn grouped(count: u64) -> String {
    let digits = count.to_string();
    let mut grouped = String::with_capacity(digits.len() + digits.len() / 3);
    for (index, digit) in digits.chars().enumerate() {
        if index > 0 && (digits.len() - index).is_multiple_of(3) {
            grouped.push(',');
        }
        grouped.push(digit);
    }
    grouped
}

/// About how wide `text` is at `size`, a little wider rather than narrower, in the UI's
/// fonts or BuhTig's: a card cannot measure text, as it is drawn by whatever shows it.
fn width(text: &str, size: f64, bold: bool) -> f64 {
    let ems: f64 = text.chars().map(advance).sum();
    ems * size * if bold { 1.06 } else { 1.0 }
}

/// About how wide `c` is, in ems.
fn advance(c: char) -> f64 {
    match c {
        ' ' => 0.27,
        'i' | 'l' | 'j' | 'I' | '!' | '|' | '.' | ',' | ':' | ';' | '\'' => 0.28,
        'f' | 'r' | 't' | '(' | ')' | '[' | ']' | '{' | '}' | '/' | '-' => 0.38,
        'm' | 'w' | 'M' | 'W' | '@' | '%' => 0.86,
        'A'..='Z' => 0.68,
        '0'..='9' => 0.58,
        c if is_wide(c) => 1.0,
        _ => 0.58,
    }
}

/// Whether `c` takes about a square, as CJK and emoji do.
fn is_wide(c: char) -> bool {
    matches!(c as u32,
        0x1100..=0x115f
        | 0x2e80..=0xa4cf
        | 0xac00..=0xd7a3
        | 0xf900..=0xfaff
        | 0xfe30..=0xfe4f
        | 0xff00..=0xff60
        | 0xffe0..=0xffe6
        | 0x1f300..=0x1faff
        | 0x20000..=0x3fffd)
}

/// `text` cut to fit in `room` at `size`, with an ellipsis if it is cut.
fn clip(text: &str, size: f64, bold: bool, room: f64) -> String {
    if width(text, size, bold) <= room {
        return text.to_owned();
    }
    ellipsize(text, size, bold, room)
}

/// `text` with an ellipsis, cut to fit in `room` at `size`: between words, unless one word
/// is too long on its own.
fn ellipsize(text: &str, size: f64, bold: bool, room: f64) -> String {
    let fits = |cut: &str| width(&format!("{cut}…"), size, bold) <= room;
    let mut cut = text.trim_end().to_owned();
    while !fits(&cut) {
        match cut.rsplit_once(' ') {
            Some((before, _)) => cut = before.trim_end().to_owned(),
            None => break,
        }
    }
    while !cut.is_empty() && !fits(&cut) {
        cut.pop();
    }
    cut.push('…');
    cut
}

/// `text` in lines that fit in `room` at `size`, broken between words, or within a word too
/// long for a line, such as CJK text, at most `most` of them, the last with an ellipsis if
/// not all of `text` fits.
fn wrap(text: &str, size: f64, room: f64, most: usize) -> Vec<String> {
    let mut lines: Vec<String> = Vec::new();
    let mut line = String::new();
    for word in text.split(' ').filter(|word| !word.is_empty()) {
        let joined = if line.is_empty() {
            word.to_owned()
        } else {
            format!("{line} {word}")
        };
        if width(&joined, size, false) <= room {
            line = joined;
            continue;
        }
        if !line.is_empty() {
            lines.push(std::mem::take(&mut line));
        }
        // A word too long for a line on its own is broken where it reaches the end.
        for c in word.chars() {
            line.push(c);
            if width(&line, size, false) > room {
                line.pop();
                lines.push(std::mem::take(&mut line));
                line.push(c);
            }
        }
    }
    if !line.is_empty() {
        lines.push(line);
    }
    if lines.len() > most {
        lines.truncate(most);
        let last = lines.pop().unwrap_or_default();
        lines.push(ellipsize(&last, size, false, room));
    }
    lines
}

#[cfg(test)]
mod tests {
    use super::*;

    fn card(facts: Option<Facts>) -> Card {
        Card {
            name: "Acme/Widget".to_owned(),
            facts,
        }
    }

    fn widget() -> Facts {
        Facts {
            description: "<b>\"Widgets\" & 'more'</b> for all".to_owned(),
            repositories: None,
            stars: Some(12_345),
            forks: Some(1),
            language: Some("Rust".to_owned()),
            activity: Some((0..60).collect()),
        }
    }

    #[test]
    fn cards_escape_what_github_says() {
        let svg = card(Some(widget())).svg("buhtig.example.com");
        assert!(
            svg.contains("&lt;b&gt;&quot;Widgets&quot; &amp; &#39;more&#39;&lt;/b&gt; for all"),
            "{svg}"
        );
        assert!(!svg.contains("<b>"), "{svg}");
        // Nothing from elsewhere, nor a style sheet that the policy would refuse.
        for absent in ["<style", "style=", "href", "<image", "<script", "url("] {
            assert!(!svg.contains(absent), "{absent}: {svg}");
        }
    }

    #[test]
    fn repository_cards_tell_their_figures_in_words() {
        let svg = card(Some(widget())).svg("buhtig.example.com");
        for text in [
            "aria-label=\"Acme/Widget on BuhTig: &lt;b&gt;",
            "12.3K stars, 1 fork, Rust, 1,742 commits in the last 52 weeks.",
            "<tspan fill=\"#59636e\">Acme/</tspan>",
            ">Widget</tspan>",
            ">12.3K</tspan><tspan fill=\"#59636e\"> stars</tspan>",
            ">1</tspan><tspan fill=\"#59636e\"> fork</tspan>",
            ">Rust</text>",
            ">1,742 commits in the last 52 weeks</text>",
            ">buhtig.example.com</text>",
        ] {
            assert!(svg.contains(text), "{text}: {svg}");
        }
    }

    #[test]
    fn account_cards_have_no_activity() {
        let facts = Facts {
            description: "We make widgets.".to_owned(),
            repositories: Some((1000, true)),
            stars: Some(2),
            forks: Some(0),
            language: None,
            activity: None,
        };
        let svg = Card {
            name: "Acme".to_owned(),
            facts: Some(facts),
        }
        .svg("localhost:8080");
        assert!(svg.contains(">1K+</tspan><tspan fill=\"#59636e\"> repositories</tspan>"));
        assert!(svg.contains(
            "aria-label=\"Acme on BuhTig: We make widgets. 1K+ repositories, 2 stars, 0 forks.\""
        ));
        assert!(!svg.contains("commits"), "{svg}");
    }

    #[test]
    fn what_is_not_known_is_not_shown() {
        let svg = card(None).svg("buhtig.example.com");
        assert!(
            svg.contains("aria-label=\"Acme/Widget on BuhTig\""),
            "{svg}"
        );
        assert!(svg.contains(&format!(">{SEE_DASHBOARD}</text>")), "{svg}");
        assert!(svg.contains(">buhtig.example.com/Acme/Widget</text>"), "{svg}");
        for absent in ["stars", "forks", "commits"] {
            assert!(!svg.contains(absent), "{absent}: {svg}");
        }
    }

    #[test]
    fn numbers_are_compact_as_in_english() {
        for (count, shown) in [
            (0, "0"),
            (999, "999"),
            (1000, "1K"),
            (1234, "1.2K"),
            (12_345, "12.3K"),
            (123_456, "123.5K"),
            (999_949, "999.9K"),
            (999_999, "1M"),
            (1_250_000, "1.3M"),
            (7_000_000_000, "7B"),
        ] {
            assert_eq!(compact(count), shown, "{count}");
        }
        assert_eq!(grouped(0), "0");
        assert_eq!(grouped(1234), "1,234");
        assert_eq!(grouped(1_234_567), "1,234,567");
    }

    #[test]
    fn long_text_is_wrapped_and_cut() {
        let lines = wrap(&"word ".repeat(100), 30.0, INNER, 3);
        assert_eq!(lines.len(), 3);
        assert!(lines.iter().all(|line| width(line, 30.0, false) <= INNER));
        assert!(lines[2].ends_with("word…"), "{lines:?}");
        // CJK has no spaces to break at.
        let lines = wrap(&"漢".repeat(200), 30.0, INNER, 3);
        assert_eq!(lines.len(), 3);
        assert!(lines.iter().all(|line| width(line, 30.0, false) <= INNER));
        assert!(lines[2].ends_with('…'));
        assert_eq!(wrap("A short one.", 30.0, INNER, 3), ["A short one."]);
        assert_eq!(wrap("", 30.0, INNER, 3), Vec::<String>::new());
    }

    #[test]
    fn long_names_fit() {
        let name = format!("{}/{}", "o".repeat(39), "r".repeat(100));
        let svg = Card { name, facts: None }.svg("buhtig.example.com");
        assert!(
            svg.contains("font-size=\"40\" font-weight=\"700\""),
            "{svg}"
        );
        assert!(svg.contains("r…</text>"), "{svg}");
    }

    #[test]
    fn xml_takes_no_control_characters() {
        assert_eq!(escape("a\u{0}b\u{7}\u{fffe}\u{ffff}c\td"), "abc\td");
    }

    /// The PNG's width and height, from its header.
    fn size(png: &[u8]) -> (u32, u32) {
        assert_eq!(&png[..8], b"\x89PNG\r\n\x1a\n");
        assert_eq!(&png[12..16], b"IHDR");
        let number = |at: usize| u32::from_be_bytes(png[at..at + 4].try_into().unwrap());
        (number(16), number(20))
    }

    #[tokio::test]
    async fn cards_are_drawn_as_png_for_chat_tools() {
        for facts in [None, Some(widget())] {
            let png = png(card(facts).svg("buhtig.example.com")).await.unwrap();
            assert_eq!(size(&png), (WIDTH, HEIGHT));
        }
        // Even with what BuhTig's fonts lack.
        let facts = Facts {
            description: "漢字とかな 🚀 Ελληνικά, кириллица".to_owned(),
            ..widget()
        };
        let png = png(card(Some(facts)).svg("buhtig.example.com"))
            .await
            .unwrap();
        assert_eq!(size(&png), (WIDTH, HEIGHT));
    }
}

