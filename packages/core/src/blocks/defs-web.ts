import { type BlockDef, C, D, Nu, S, Tx } from './schema';

const CONTAINER_TAGS = ['div', 'section', 'header', 'footer', 'main', 'nav', 'article', 'aside', 'ul', 'ol', 'li', 'form', 'table', 'tr', 'span'];
const TEXT_TAGS = ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'span', 'li', 'label', 'strong', 'em', 'td', 'th', 'pre', 'code'];
const JUSTIFY = ['flex-start', 'center', 'flex-end', 'space-between', 'space-around', 'space-evenly'];
const ALIGN = ['stretch', 'flex-start', 'center', 'flex-end', 'baseline'];

const node = (d: Omit<BlockDef, 'domain' | 'prev' | 'category' | 'style'> & { category?: string }): BlockDef => ({ domain: 'web', prev: 'WebNode', category: 'html', style: 'web_blocks', ...d });
const decl = (d: Omit<BlockDef, 'domain' | 'prev' | 'category' | 'style'> & { category?: string }): BlockDef => ({ domain: 'web', prev: 'CssDecl', category: 'cssprops', style: 'css_blocks', ...d });

export const WEB_BLOCKS: BlockDef[] = [
  { type: 'web_document', domain: 'web', category: 'html', style: 'start_blocks', hat: true, rows: [['HTML document, title %1 language %2', Tx('TITLE', 'My page'), Tx('LANG', 'en')], ['body %1', S('BODY', 'WebNode')], ['styles %1', S('STYLE', 'CssRule')], ['script %1', S('SCRIPT', 'Stmt')]], tip: 'The root of an HTML page. Styles become a <style> element and script blocks become inline JavaScript.' },
  node({ type: 'web_element', rows: [['<%1> id %2 class %3', D('TAG', ...CONTAINER_TAGS), Tx('ID', ''), Tx('CLASS', '')], ['%1', S('CHILDREN', 'WebNode')]] }),
  node({ type: 'web_text_element', rows: [['<%1> %2 id %3 class %4', D('TAG', ...TEXT_TAGS), Tx('TEXT', 'Hello'), Tx('ID', ''), Tx('CLASS', '')]] }),
  node({ type: 'web_text', rows: [['text %1', Tx('TEXT', 'text')]] }),
  node({ type: 'web_link', rows: [['link %1 to %2', Tx('TEXT', 'Open'), Tx('HREF', 'https://example.com')]] }),
  node({ type: 'web_image', rows: [['image %1 description %2', Tx('SRC', 'image.png'), Tx('ALT', '')]] }),
  node({ type: 'web_button', rows: [['button %1 id %2 class %3', Tx('TEXT', 'Click'), Tx('ID', 'button'), Tx('CLASS', '')]] }),
  node({ type: 'web_input', rows: [['input %1 placeholder %2 id %3', D('TYPE', 'text', 'number', 'password', 'email', 'checkbox', 'date', 'range', 'color'), Tx('PLACEHOLDER', ''), Tx('ID', 'input')]] }),
  node({ type: 'web_void', rows: [['%1', D('TAG', ['line break', 'br'], ['horizontal rule', 'hr'])]] }),
  node({ type: 'web_flex', category: 'layout', rows: [['flex box %1 justify %2 align %3 gap %4 px wrap %5', D('DIR', 'row', 'column', 'row-reverse', 'column-reverse'), D('JUSTIFY', ...JUSTIFY), D('ALIGN', ...ALIGN), Nu('GAP', 8, { min: 0 }), C('WRAP')], ['%1', S('CHILDREN', 'WebNode')]], tip: 'A container laid out with CSS Flexbox.' }),
  node({ type: 'web_grid', category: 'layout', rows: [['grid columns %1 gap %2 px', Tx('COLUMNS', '1fr 1fr 1fr'), Nu('GAP', 8, { min: 0 })], ['%1', S('CHILDREN', 'WebNode')]], tip: 'A container laid out with CSS Grid.' }),
  node({ type: 'web_custom', rows: [['element <%1> attributes %2', Tx('TAG', 'div'), Tx('ATTRS', '')], ['%1', S('CHILDREN', 'WebNode')]], tip: 'Any element. Attributes are written as name="value" pairs.' }),

  // ----- CSS rules -----
  { type: 'css_rule', domain: 'web', category: 'css', style: 'css_blocks', prev: 'CssRule', rows: [['style %1', Tx('SELECTOR', '.box')], ['%1', S('DECLS', 'CssDecl')]] },
  { type: 'css_media', domain: 'web', category: 'css', style: 'css_blocks', prev: 'CssRule', rows: [['when screen %1 %2 px', D('COND', ['is at most', 'max-width'], ['is at least', 'min-width']), Nu('VALUE', 600, { min: 0 })], ['%1', S('RULES', 'CssRule')]], tip: 'Responsive rules inside a media query.' },

  // ----- CSS declarations -----
  decl({ type: 'css_decl', rows: [['%1 : %2', Tx('PROP', 'margin'), Tx('VALUE', '0 auto')]] }),
  decl({ type: 'css_color', rows: [['%1 : %2', D('PROP', 'color', 'background-color', 'border-color'), Tx('VALUE', '#4176e6')]] }),
  decl({ type: 'css_size', rows: [['%1 : %2 %3', D('PROP', 'width', 'height', 'min-width', 'max-width', 'min-height', 'max-height', 'margin', 'padding', 'font-size', 'gap', 'border-radius', 'line-height', 'top', 'left', 'right', 'bottom'), Nu('VALUE', 16), D('UNIT', 'px', '%', 'em', 'rem', 'vw', 'vh', 'fr')]] }),
  decl({ type: 'css_display', rows: [['display : %1', D('VALUE', 'block', 'inline', 'inline-block', 'flex', 'grid', 'none')]] }),
  decl({ type: 'css_flex', category: 'layout', rows: [['flex %1 justify %2 align %3 wrap %4', D('DIR', 'row', 'column', 'row-reverse', 'column-reverse'), D('JUSTIFY', ...JUSTIFY), D('ALIGN', ...ALIGN), C('WRAP')]] }),
  decl({ type: 'css_grid', category: 'layout', rows: [['grid columns %1 rows %2 gap %3 px', Tx('COLUMNS', 'repeat(3, 1fr)'), Tx('ROWS', ''), Nu('GAP', 8, { min: 0 })]] }),
  decl({ type: 'css_font', rows: [['font %1 weight %2', Tx('FAMILY', 'system-ui, sans-serif'), D('WEIGHT', '400', '300', '500', '600', '700')]] }),
  decl({ type: 'css_text_align', rows: [['text align %1', D('VALUE', 'left', 'center', 'right', 'justify')]] }),
  decl({ type: 'css_border', rows: [['border %1 px %2 %3', Nu('WIDTH', 1, { min: 0 }), D('STYLE', 'solid', 'dashed', 'dotted', 'double', 'none'), Tx('COLOR', '#d0d4d8')]] }),
  decl({ type: 'css_position', rows: [['position : %1', D('VALUE', 'static', 'relative', 'absolute', 'fixed', 'sticky')]] }),
];
