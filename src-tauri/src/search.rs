//! Search box syntax (Eagle-compatible subset):
//!   `cat dog`            both words (AND)
//!   `-cat`               exclude
//!   `cat OR dog`, `||`   either
//!   `(cat OR dog) black` grouping
//!   `"cat food"`         phrase
//! Malformed input never fails: stray parentheses / operators are ignored.

#[derive(Debug, Clone, PartialEq)]
pub enum Expr {
    Term(String),
    Not(Box<Expr>),
    And(Vec<Expr>),
    Or(Vec<Expr>),
}

#[derive(Debug, Clone, PartialEq)]
enum Tok {
    LParen,
    RParen,
    Or,
    Minus,
    Word(String),
}

fn tokenize(input: &str) -> Vec<Tok> {
    let chars: Vec<char> = input.chars().collect();
    let mut out = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if c.is_whitespace() {
            i += 1;
        } else if c == '(' {
            out.push(Tok::LParen);
            i += 1;
        } else if c == ')' {
            out.push(Tok::RParen);
            i += 1;
        } else if c == '|' && chars.get(i + 1) == Some(&'|') {
            out.push(Tok::Or);
            i += 2;
        } else if c == '-' && chars.get(i + 1).is_some_and(|n| !n.is_whitespace()) {
            out.push(Tok::Minus);
            i += 1;
        } else if c == '"' {
            let end = chars[i + 1..].iter().position(|&x| x == '"').map(|p| i + 1 + p);
            let word: String = chars[i + 1..end.unwrap_or(chars.len())].iter().collect();
            if !word.trim().is_empty() {
                out.push(Tok::Word(word));
            }
            i = end.map_or(chars.len(), |e| e + 1);
        } else {
            let start = i;
            while i < chars.len()
                && !chars[i].is_whitespace()
                && !matches!(chars[i], '(' | ')' | '"')
                && (chars[i] != '|' || chars.get(i + 1) != Some(&'|'))
            {
                i += 1;
            }
            let word: String = chars[start..i].iter().collect();
            out.push(if word == "OR" { Tok::Or } else { Tok::Word(word) });
        }
    }
    out
}

struct Parser {
    toks: Vec<Tok>,
    pos: usize,
}

impl Parser {
    fn peek(&self) -> Option<&Tok> {
        self.toks.get(self.pos)
    }

    fn or(&mut self) -> Option<Expr> {
        let mut parts = Vec::new();
        parts.extend(self.and());
        while self.peek() == Some(&Tok::Or) {
            self.pos += 1;
            parts.extend(self.and());
        }
        match parts.len() {
            0 => None,
            1 => parts.pop(),
            _ => Some(Expr::Or(parts)),
        }
    }

    fn and(&mut self) -> Option<Expr> {
        let mut parts = Vec::new();
        while let Some(t) = self.peek() {
            if matches!(t, Tok::Or | Tok::RParen) {
                break;
            }
            parts.extend(self.unary());
        }
        match parts.len() {
            0 => None,
            1 => parts.pop(),
            _ => Some(Expr::And(parts)),
        }
    }

    fn unary(&mut self) -> Option<Expr> {
        if self.peek() == Some(&Tok::Minus) {
            self.pos += 1;
            return self.unary().map(|e| Expr::Not(Box::new(e)));
        }
        self.primary()
    }

    fn primary(&mut self) -> Option<Expr> {
        match self.toks.get(self.pos).cloned()? {
            Tok::Word(w) => {
                self.pos += 1;
                Some(Expr::Term(w))
            }
            Tok::LParen => {
                self.pos += 1;
                let e = self.or();
                if self.peek() == Some(&Tok::RParen) {
                    self.pos += 1;
                }
                e
            }
            // Stray tokens are skipped.
            Tok::RParen | Tok::Or | Tok::Minus => {
                self.pos += 1;
                None
            }
        }
    }
}

pub fn parse(input: &str) -> Option<Expr> {
    let mut p = Parser { toks: tokenize(input), pos: 0 };
    let mut parts = Vec::new();
    while p.pos < p.toks.len() {
        let before = p.pos;
        parts.extend(p.or());
        if p.pos == before {
            p.pos += 1; // unmatched ")" at top level
        }
    }
    match parts.len() {
        0 => None,
        1 => parts.pop(),
        _ => Some(Expr::And(parts)),
    }
}

/// Renders the expression as SQL. `term_sql` produces the condition for one
/// term and pushes its bind values.
pub fn to_sql(e: &Expr, term_sql: &mut dyn FnMut(&str) -> String) -> String {
    match e {
        Expr::Term(w) => term_sql(w),
        Expr::Not(inner) => format!("NOT ({})", to_sql(inner, term_sql)),
        Expr::And(v) => format!(
            "({})",
            v.iter().map(|x| to_sql(x, term_sql)).collect::<Vec<_>>().join(" AND ")
        ),
        Expr::Or(v) => format!(
            "({})",
            v.iter().map(|x| to_sql(x, term_sql)).collect::<Vec<_>>().join(" OR ")
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn t(s: &str) -> Expr {
        Expr::Term(s.into())
    }
    fn not(e: Expr) -> Expr {
        Expr::Not(Box::new(e))
    }

    #[test]
    fn parses_syntax() {
        assert_eq!(parse(""), None);
        assert_eq!(parse("   "), None);
        assert_eq!(parse("cat"), Some(t("cat")));
        assert_eq!(parse("cat dog"), Some(Expr::And(vec![t("cat"), t("dog")])));
        assert_eq!(parse("-cat"), Some(not(t("cat"))));
        assert_eq!(parse("a-b"), Some(t("a-b")), "hyphen inside a word is literal");
        assert_eq!(parse("cat OR dog"), Some(Expr::Or(vec![t("cat"), t("dog")])));
        assert_eq!(parse("cat||dog"), Some(Expr::Or(vec![t("cat"), t("dog")])));
        assert_eq!(parse("cat or dog"), Some(Expr::And(vec![t("cat"), t("or"), t("dog")])));
        assert_eq!(
            parse("(cat OR dog) black"),
            Some(Expr::And(vec![Expr::Or(vec![t("cat"), t("dog")]), t("black")]))
        );
        assert_eq!(
            parse(r#"("cat food" || "dog food") -pet store"#),
            Some(Expr::And(vec![
                Expr::Or(vec![t("cat food"), t("dog food")]),
                not(t("pet")),
                t("store")
            ]))
        );
    }

    #[test]
    fn tolerates_garbage() {
        assert_eq!(parse("(cat"), Some(t("cat")));
        assert_eq!(parse("cat)"), Some(t("cat")));
        assert_eq!(parse(") ) cat"), Some(t("cat")));
        assert_eq!(parse("OR cat OR"), Some(t("cat")));
        assert_eq!(parse("- cat"), Some(Expr::And(vec![t("-"), t("cat")])));
        assert_eq!(parse(r#""unterminated"#), Some(t("unterminated")));
        assert_eq!(parse("()"), None);
    }

    #[test]
    fn renders_sql() {
        let e = parse("(a OR b) -c").unwrap();
        let mut n = 0;
        let sql = to_sql(&e, &mut |w| {
            n += 1;
            format!("T({w})")
        });
        assert_eq!(sql, "((T(a) OR T(b)) AND NOT (T(c)))");
        assert_eq!(n, 3);
    }
}
