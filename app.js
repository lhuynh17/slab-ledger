const { useState, useEffect, useRef, useCallback, useMemo } = React;
const { idbGet, idbSet, idbDelete } = window.appStorage;
const { psaLookupCert, mapPSAResponse } = window.psaApi;

/* ------------------------------------------------------------------ */
/* Constants + helpers                                                 */
/* ------------------------------------------------------------------ */

const INV_KEY = 'inventory';
const TOKEN_KEY = 'psa_token';
const THEME_KEY = 'theme';
const SOURCE_PRESETS = ['Local Purchase', 'eBay', 'Card Show', 'Trade-in', 'Consignment', 'Other'];
const GRADES = ['10', '9.5', '9', '8.5', '8', '7.5', '7', '6', '5', '4', '3', '2', '1', 'Authentic'];
const PAYMENT_MEDIUMS = ['Cash', 'Venmo', 'PayPal', 'Zelle', 'CashApp', 'Credit Card', 'Check', 'Trade + Cash', 'Other'];

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const todayISO = () => new Date().toISOString();
const isSameDay = (iso, ref) => {
  if (!iso) return false;
  const a = new Date(iso), b = ref || new Date();
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
};
const money = (n) => {
  const v = Number(n);
  if (Number.isNaN(v)) return '$0.00';
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
};
const shortDate = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
};

async function loadInventory() {
  try {
    const data = await idbGet(INV_KEY);
    return Array.isArray(data) ? data : [];
  } catch (e) { return []; }
}
async function saveInventory(items) {
  try { await idbSet(INV_KEY, items); return true; } catch (e) { return false; }
}
async function loadToken() {
  try { return (await idbGet(TOKEN_KEY)) || ''; } catch (e) { return ''; }
}
async function saveToken(token) {
  try { await idbSet(TOKEN_KEY, token); return true; } catch (e) { return false; }
}
async function loadTheme() {
  try { return (await idbGet(THEME_KEY)) || null; } catch (e) { return null; }
}
async function saveTheme(theme) {
  try { await idbSet(THEME_KEY, theme); return true; } catch (e) { return false; }
}
function applyThemeColorMeta(theme) {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'light' ? '#F5F5F3' : '#050507');
}

const photoKey = (id) => `photo:${id}`;
async function loadPhoto(id) {
  try { return await idbGet(photoKey(id)); } catch (e) { return null; }
}
async function savePhoto(id, dataUrl) {
  try {
    if (dataUrl) await idbSet(photoKey(id), dataUrl);
    else await idbDelete(photoKey(id));
    return true;
  } catch (e) { return false; }
}

function resizeImageFile(file, maxDim = 1000, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      let { width, height } = img;
      if (width > height && width > maxDim) { height = Math.round(height * (maxDim / width)); width = maxDim; }
      else if (height > maxDim) { width = Math.round(width * (maxDim / height)); height = maxDim; }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

function ebaySoldSearchUrl(item) {
  const query = `${item.cardName} PSA ${item.grade}`.trim();
  return `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(query)}&LH_Sold=1&LH_Complete=1`;
}

function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('Could not read file'));
    r.readAsDataURL(file);
  });
}

async function ocrCertNumber(file) {
  const dataUrl = await fileToDataURL(file);
  const result = await Tesseract.recognize(dataUrl, 'eng');
  const text = result.data.text || '';
  const matches = text.match(/\d{7,10}/g) || [];
  matches.sort((a, b) => b.length - a.length);
  return { text, certNumber: matches[0] || '' };
}

/* ------------------------------------------------------------------ */
/* Icons — small inline SVGs, no external icon library needed          */
/* ------------------------------------------------------------------ */

const ICON_PATHS = {
  plus: <><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></>,
  x: <><line x1="6" y1="6" x2="18" y2="18" /><line x1="6" y1="18" x2="18" y2="6" /></>,
  check: <polyline points="4 12 9 17 20 6" />,
  chevronRight: <polyline points="9 6 15 12 9 18" />,
  arrowLeft: <><line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" /></>,
  search: <><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></>,
  trash: <><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" /><line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" /></>,
  edit: <><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" /></>,
  camera: <><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" /><circle cx="12" cy="13" r="4" /></>,
  image: <><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></>,
  dollar: <><line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" /></>,
  repeat: <><polyline points="17 1 21 5 17 9" /><path d="M3 11V9a4 4 0 014-4h14" /><polyline points="7 23 3 19 7 15" /><path d="M21 13v2a4 4 0 01-4 4H3" /></>,
  zap: <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.65 1.65 0 004.6 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.6a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06A1.65 1.65 0 0019.4 9c.16.31.4.58.7.77.3.19.65.29 1 .29H21a2 2 0 010 4h-.09c-.35 0-.7.1-1 .29-.3.19-.54.46-.7.77z" /></>,
  alert: <><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></>,
  download: <><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></>,
  package: <><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" /><polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" /></>,
  external: <><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></>,
  save: <><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" /><polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" /></>,
  lightbulb: <><path d="M9 18h6" /><path d="M10 22h4" /><path d="M12 2a6 6 0 00-4 10.5c.6.6 1 1.4 1 2.5h6c0-1.1.4-1.9 1-2.5A6 6 0 0012 2z" /></>,
  tag: <><path d="M20.59 13.41L11 3.83A2 2 0 009.59 3.25H4a1 1 0 00-1 1v5.59a2 2 0 00.59 1.41l9.58 9.58a2 2 0 002.83 0l5.59-5.59a2 2 0 000-2.83z" /><circle cx="7.5" cy="7.5" r="1.25" fill="currentColor" stroke="none" /></>,
};

function Icon({ name, size = 18, className = '', style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className={className} style={style}>
      {ICON_PATHS[name] || null}
    </svg>
  );
}

function LogoMark({ size = 26 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <rect x="4" y="3" width="13" height="18" rx="2" transform="rotate(-8 4 3)" stroke="var(--gold)" strokeWidth="1.6" />
      <rect x="7" y="4" width="13" height="18" rx="2" fill="var(--surface2)" stroke="var(--gold)" strokeWidth="1.6" />
      <line x1="10" y1="9" x2="17" y2="9" stroke="var(--gold)" strokeWidth="1.4" strokeLinecap="round" />
      <line x1="10" y1="13" x2="17" y2="13" stroke="var(--gold)" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Tiny UI atoms                                                       */
/* ------------------------------------------------------------------ */

function Field({ label, children, required }) {
  return (
    <label className="block mb-4">
      <span className="block text-xs uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-dim)' }}>
        {label}{required && <span style={{ color: 'var(--danger)' }}> *</span>}
      </span>
      {children}
    </label>
  );
}

const inputStyle = { background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)' };

const TextInput = React.forwardRef((props, ref) => (
  <input {...props} ref={ref} style={inputStyle}
    className={`w-full rounded-lg px-4 py-3.5 text-base focus:outline-none ${props.className || ''}`} />
));

function Select(props) {
  return <select {...props} style={inputStyle} className="w-full rounded-lg px-4 py-3.5 text-base focus:outline-none">{props.children}</select>;
}

function Btn({ children, onClick, variant = 'primary', className = '', type = 'button', disabled }) {
  const base = 'w-full rounded-lg py-3.5 px-4 text-base font-semibold flex items-center justify-center gap-2 active:scale-[0.98] transition-transform disabled:opacity-40';
  const styles = {
    primary: { background: 'var(--gold)', color: '#1a1305' },
    danger: { background: 'var(--danger)', color: '#fff' },
    ghost: { background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)' },
    outlineGold: { background: 'transparent', color: 'var(--gold)', border: '1px solid var(--gold)' },
  };
  const shadowed = variant === 'primary' || variant === 'danger';
  return <button type={type} disabled={disabled} onClick={onClick} className={`${base} ${shadowed ? 'shadow-btn' : ''} ${className}`} style={styles[variant]}>{children}</button>;
}

function StatusBadge({ status }) {
  const colors = {
    'In Inventory': { bg: 'rgba(63,163,93,0.15)', text: 'var(--green)' },
    'Sold': { bg: 'rgba(201,162,75,0.18)', text: 'var(--gold)' },
    'Traded': { bg: 'rgba(120,150,220,0.18)', text: '#9AB4F0' },
  };
  const c = colors[status] || colors['In Inventory'];
  return <span className="text-xs font-bold uppercase tracking-wide px-2 py-1 rounded" style={{ background: c.bg, color: c.text }}>{status}</span>;
}

function SlabChip({ item, onClick }) {
  return (
    <button onClick={onClick} className="w-full text-left rounded-xl overflow-hidden active:scale-[0.98] transition-transform shadow-card" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
      <div className="flex">
        <div className="flex flex-col items-center justify-center px-3 py-2 shrink-0" style={{ background: 'var(--accent)', minWidth: 64 }}>
          <span className="text-[10px] font-bold tracking-widest text-white/80">GRADE</span>
          <span className="font-display text-2xl font-bold text-white leading-none mt-0.5">{item.grade}</span>
        </div>
        <div className="flex-1 min-w-0 px-3 py-2">
          <div className="flex items-start justify-between gap-2">
            <p className="font-semibold text-sm truncate" style={{ color: 'var(--text)' }}>{item.cardName || 'Unnamed card'}</p>
            <StatusBadge status={item.status} />
          </div>
          <p className="font-mono text-xs mt-1" style={{ color: 'var(--text-dim)' }}>CERT #{item.certNumber || '—'}</p>
          <div className="flex items-center justify-between mt-1.5">
            <span className="text-xs tabular-nums" style={{ color: 'var(--text-dim)' }}>Cost {money(item.cost)}</span>
            {item.status === 'Sold' && <span className="text-xs font-semibold tabular-nums" style={{ color: item.sale?.netProfit >= 0 ? 'var(--green)' : 'var(--danger)' }}>Net {money(item.sale?.netProfit)}</span>}
            {item.status === 'Traded' && <span className="text-xs font-semibold tabular-nums" style={{ color: item.trade?.gainLoss >= 0 ? 'var(--green)' : 'var(--danger)' }}>Δ {money(item.trade?.gainLoss)}</span>}
          </div>
        </div>
        <div className="flex items-center pr-2" style={{ color: 'var(--text-dim)' }}><Icon name="chevronRight" size={18} /></div>
      </div>
    </button>
  );
}

function Toast({ text }) {
  if (!text) return null;
  return (
    <div className="fixed top-3 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-full text-sm font-semibold shadow-lg flex items-center gap-2" style={{ background: 'var(--green)', color: '#08210F' }}>
      <Icon name="check" size={16} /> {text}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Barcode scanner (native BarcodeDetector, free/offline)              */
/* ------------------------------------------------------------------ */

function ScannerModal({ onDetect, onClose }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function start() {
      if (!('BarcodeDetector' in window)) {
        setError('Barcode scanning isn\u2019t supported in this browser. Enter the cert number manually.');
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
        const detector = new window.BarcodeDetector({ formats: ['code_128', 'code_39', 'qr_code', 'ean_13', 'pdf417'] });
        const tick = async () => {
          if (cancelled || !videoRef.current) return;
          try {
            const codes = await detector.detect(videoRef.current);
            if (codes && codes[0]?.rawValue) {
              onDetect(codes[0].rawValue.replace(/\D/g, '') || codes[0].rawValue);
              return;
            }
          } catch (e) { /* keep trying */ }
          rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
      } catch (e) {
        setError('Camera access was blocked or unavailable. Enter the cert number manually.');
      }
    }
    start();
    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
    };
  }, [onDetect]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col" style={{ background: '#000' }}>
      <div className="flex items-center justify-between px-4 py-3" style={{ background: 'var(--surface)' }}>
        <span className="font-semibold" style={{ color: 'var(--text)' }}>Scan cert barcode</span>
        <button onClick={onClose} style={{ color: 'var(--text)' }}><Icon name="x" size={22} /></button>
      </div>
      <div className="flex-1 relative flex items-center justify-center">
        {!error ? (
          <>
            <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />
            <div className="absolute inset-x-8 top-1/2 -translate-y-1/2 h-24 rounded-xl" style={{ border: '2px solid var(--gold)' }} />
          </>
        ) : (
          <div className="px-8 text-center flex flex-col items-center gap-3">
            <Icon name="alert" size={28} style={{ color: 'var(--gold)' }} />
            <p style={{ color: 'var(--text)' }}>{error}</p>
            <Btn onClick={onClose} variant="outlineGold" className="mt-2">Got it</Btn>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Add / Edit Slab screen                                              */
/* ------------------------------------------------------------------ */

function emptyForm() { return { certNumber: '', cardName: '', grade: '10', gradeLabel: '', cost: '', source: '', notes: '', tags: [] }; }

function normalizeGrade(g) {
  if (!g) return null;
  const cleaned = String(g).replace(/psa/i, '').trim();
  const match = GRADES.find((gr) => gr.toLowerCase() === cleaned.toLowerCase());
  return match || (cleaned ? cleaned : null);
}

function CollectionOverview({ items }) {
  const onHand = items.filter((it) => it.status === 'In Inventory').length;
  const totalValue = items.filter((it) => it.status === 'In Inventory').reduce((s, it) => s + (it.cost || 0), 0);
  return (
    <div className="rounded-lg p-4 mb-4 shadow-card" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
      <p className="text-xs uppercase tracking-wider mb-3" style={{ color: 'var(--text-dim)' }}>Collection Overview</p>
      <div className="grid grid-cols-3 gap-2 text-center">
        <div>
          <p className="font-display text-2xl font-bold tabular-nums" style={{ color: 'var(--text)' }}>{onHand}</p>
          <p className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--text-dim)' }}>On Hand</p>
        </div>
        <div>
          <p className="font-display text-2xl font-bold tabular-nums" style={{ color: 'var(--text)' }}>{items.length}</p>
          <p className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--text-dim)' }}>Total Slabs</p>
        </div>
        <div>
          <p className="font-display text-2xl font-bold tabular-nums" style={{ color: 'var(--gold)' }}>{money(totalValue)}</p>
          <p className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--text-dim)' }}>Total Value</p>
        </div>
      </div>
    </div>
  );
}

function QuickTips() {
  return (
    <div className="rounded-lg p-3 mt-4 flex items-start gap-3 shadow-card" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
      <Icon name="lightbulb" size={18} style={{ color: 'var(--gold)', flexShrink: 0, marginTop: 2 }} />
      <div>
        <p className="text-sm font-semibold mb-0.5" style={{ color: 'var(--text)' }}>Quick tip</p>
        <p className="text-xs" style={{ color: 'var(--text-dim)' }}>For best results, take a clear, well-lit photo of the PSA label — avoid glare across the barcode and cert number.</p>
      </div>
    </div>
  );
}

function AddSlabScreen({ editingItem, onSaved, onCancelEdit, notify, psaToken, items }) {
  const [form, setForm] = useState(editingItem ? {
    certNumber: editingItem.certNumber, cardName: editingItem.cardName, grade: editingItem.grade,
    gradeLabel: editingItem.gradeLabel || '', cost: String(editingItem.cost ?? ''), source: editingItem.source,
    notes: editingItem.notes, tags: editingItem.tags || [],
  } : emptyForm());
  const [scanning, setScanning] = useState(false);
  const [ocrState, setOcrState] = useState('idle'); // idle | reading | done | error
  const [lookupState, setLookupState] = useState('idle'); // idle | looking | done | error | no-token
  const [note, setNote] = useState(null); // { tone, text }
  const [photoDataUrl, setPhotoDataUrl] = useState(null);
  const [tagInput, setTagInput] = useState('');
  const [addingTag, setAddingTag] = useState(false);
  const [sourceOther, setSourceOther] = useState(false);
  const certRef = useRef(null);
  const cameraInputRef = useRef(null);
  const libraryInputRef = useRef(null);
  const photoCameraRef = useRef(null);
  const photoLibraryRef = useRef(null);

  useEffect(() => {
    if (editingItem) {
      setForm({
        certNumber: editingItem.certNumber, cardName: editingItem.cardName, grade: editingItem.grade,
        gradeLabel: editingItem.gradeLabel || '', cost: String(editingItem.cost ?? ''), source: editingItem.source,
        notes: editingItem.notes, tags: editingItem.tags || [],
      });
      setSourceOther(!!editingItem.source && !SOURCE_PRESETS.includes(editingItem.source));
      loadPhoto(editingItem.id).then(setPhotoDataUrl);
    } else {
      setPhotoDataUrl(null);
    }
  }, [editingItem]);

  useEffect(() => { certRef.current?.focus(); }, []);

  const handleCardPhoto = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const dataUrl = await resizeImageFile(file);
      setPhotoDataUrl(dataUrl);
    } catch (err) { /* silently skip a bad image */ }
  };

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const canSave = form.certNumber.trim().length > 0 && form.cardName.trim().length > 0;

  const addTag = () => {
    const t = tagInput.trim();
    if (t && !form.tags.includes(t)) setForm((f) => ({ ...f, tags: [...f.tags, t] }));
    setTagInput('');
    setAddingTag(false);
  };
  const removeTag = (t) => setForm((f) => ({ ...f, tags: f.tags.filter((x) => x !== t) }));

  const runPsaLookup = async (cert) => {
    if (!psaToken) {
      setLookupState('no-token');
      setNote({ tone: 'limited', text: 'Cert number captured. Add a PSA API token in Settings to auto-fill the name and grade, or fill them in manually.' });
      return;
    }
    setLookupState('looking');
    try {
      const data = await psaLookupCert(cert, psaToken);
      const mapped = mapPSAResponse(data);
      if (mapped.found) {
        setForm((f) => ({ ...f, cardName: mapped.cardName || f.cardName, grade: normalizeGrade(mapped.grade) || f.grade, gradeLabel: mapped.gradeLabel || f.gradeLabel }));
        setNote({ tone: 'good', text: 'Auto-filled from PSA\u2019s cert database \u2014 double-check before saving.' });
      } else {
        setNote({ tone: 'limited', text: 'PSA didn\u2019t return a matching record for that cert number. Double-check the digits or fill in manually.' });
      }
      setLookupState('done');
    } catch (err) {
      setLookupState('error');
      if (err.code === 'AUTH') {
        setNote({ tone: 'error', text: 'PSA rejected your API token \u2014 it may have expired. Grab a fresh one from psacard.com/publicapi and update it in Settings.' });
      } else if (err.code === 'RATE_LIMIT') {
        setNote({ tone: 'limited', text: 'PSA is rate-limiting lookups right now (free tier: 100/day, plus short-term throttling). Cert number is saved \u2014 wait a bit before trying again, or fill in the rest manually.' });
      } else {
        setNote({ tone: 'error', text: 'PSA lookup failed. Cert number is saved \u2014 fill in the rest manually or try the lookup again.' });
      }
    }
  };

  const handlePhoto = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setOcrState('reading');
    setNote(null);
    try {
      const { certNumber } = await ocrCertNumber(file);
      if (certNumber) {
        setForm((f) => ({ ...f, certNumber }));
        setOcrState('done');
        await runPsaLookup(certNumber);
      } else {
        setOcrState('done');
        setNote({ tone: 'limited', text: 'Couldn\u2019t clearly read a cert number from that photo. Try better lighting/focus, or enter it manually.' });
      }
    } catch (err) {
      setOcrState('error');
      setNote({ tone: 'error', text: 'Couldn\u2019t read that photo. Enter the cert number manually.' });
    }
  };

  const handleSave = async () => {
    if (!canSave) return;
    const payload = {
      certNumber: form.certNumber.trim(), cardName: form.cardName.trim(), grade: form.grade, gradeLabel: form.gradeLabel,
      cost: parseFloat(form.cost) || 0, source: form.source.trim(), notes: form.notes.trim(), tags: form.tags,
    };
    if (editingItem) {
      await onSaved({ ...editingItem, ...payload });
      await savePhoto(editingItem.id, photoDataUrl);
      notify('Slab updated');
      onCancelEdit();
    } else {
      const item = { id: uid(), ...payload, status: 'In Inventory', dateAdded: todayISO(), sale: null, trade: null };
      await onSaved(item);
      await savePhoto(item.id, photoDataUrl);
      notify('Added to inventory');
      setForm(emptyForm());
      setPhotoDataUrl(null);
      setSourceOther(false);
      setOcrState('idle'); setLookupState('idle'); setNote(null);
      certRef.current?.focus();
    }
  };

  const busy = ocrState === 'reading' || lookupState === 'looking';
  const noteColors = { good: 'var(--green)', limited: 'var(--gold)', error: 'var(--danger)' };
  const noteTitles = { good: 'PSA Lookup Successful', limited: 'Cert Captured', error: 'Lookup Issue' };

  return (
    <div className="px-4 pt-4 pb-28">
      {editingItem && (
        <button onClick={onCancelEdit} className="flex items-center gap-1 mb-3 text-sm" style={{ color: 'var(--text-dim)' }}>
          <Icon name="arrowLeft" size={16} /> Cancel edit
        </button>
      )}
      <h1 className="font-display text-2xl font-bold mb-4" style={{ color: 'var(--text)' }}>{editingItem ? 'Edit Slab' : 'Add Slab'}</h1>

      {!editingItem && <CollectionOverview items={items} />}

      <div className="rounded-lg p-4 mb-4 shadow-card" style={{ background: 'var(--surface)', border: '1px solid var(--gold)' }}>
        <div className="flex items-center gap-3 mb-4">
          <div className="rounded-full flex items-center justify-center shrink-0" style={{ width: 40, height: 40, background: 'rgba(201,162,75,0.15)' }}>
            <Icon name="zap" size={20} style={{ color: 'var(--gold)' }} />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Look up your card on PSA</p>
            <p className="text-xs" style={{ color: 'var(--text-dim)' }}>Snap a photo of the label or upload one and we'll fill in the details.</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 mb-4">
          <button onClick={() => cameraInputRef.current?.click()} disabled={busy}
            className="rounded-lg px-3 py-2.5 flex items-center justify-center gap-1.5 text-sm font-semibold disabled:opacity-50"
            style={{ background: 'var(--gold)', color: '#1a1305' }}>
            <Icon name="camera" size={16} />
            {ocrState === 'reading' ? 'Reading…' : lookupState === 'looking' ? 'Looking up…' : 'Take Photo'}
          </button>
          <button onClick={() => libraryInputRef.current?.click()} disabled={busy}
            className="rounded-lg px-3 py-2.5 flex items-center justify-center gap-1.5 text-sm font-semibold disabled:opacity-50"
            style={{ background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)' }}>
            <Icon name="image" size={16} /> Upload Photo
          </button>
        </div>
        <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handlePhoto} />
        <input ref={libraryInputRef} type="file" accept="image/*" className="hidden" onChange={handlePhoto} />

        <div className="flex items-center gap-3 mb-4">
          <div className="flex-1 h-px" style={{ background: 'var(--border)' }} />
          <span className="text-xs font-semibold" style={{ color: 'var(--text-dim)' }}>OR</span>
          <div className="flex-1 h-px" style={{ background: 'var(--border)' }} />
        </div>

        <Field label="Enter PSA cert number manually">
          <div className="flex gap-2">
            <TextInput ref={certRef} inputMode="numeric" value={form.certNumber} onChange={set('certNumber')} />
            <button onClick={() => setScanning(true)} className="shrink-0 rounded-lg px-4 flex items-center justify-center" style={{ background: 'var(--accent)' }} aria-label="Scan barcode">
              <Icon name="camera" size={20} style={{ color: '#fff' }} />
            </button>
          </div>
        </Field>
        <Btn onClick={() => form.certNumber.trim() && runPsaLookup(form.certNumber.trim())} disabled={!form.certNumber.trim() || lookupState === 'looking'} variant="ghost">
          <Icon name="search" size={16} /> Look Up
        </Btn>
      </div>

      {note && (
        <div className="rounded-lg p-3 mb-4 flex items-start gap-3" style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${noteColors[note.tone]}` }}>
          <div className="rounded-full flex items-center justify-center shrink-0 mt-0.5" style={{ width: 22, height: 22, background: noteColors[note.tone] }}>
            <Icon name={note.tone === 'good' ? 'check' : 'alert'} size={13} style={{ color: note.tone === 'good' ? '#08210F' : '#fff' }} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>{noteTitles[note.tone]}</p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-dim)' }}>{note.text}</p>
          </div>
          {photoDataUrl && <img src={photoDataUrl} alt="" className="rounded-lg shrink-0" style={{ width: 48, height: 48, objectFit: 'cover' }} />}
        </div>
      )}

      <Field label="Card name" required>
        <div className="relative">
          <textarea rows={2} value={form.cardName} onChange={set('cardName')}
            style={inputStyle} className="w-full rounded-lg px-4 py-3 pr-9 text-base focus:outline-none" />
          {form.cardName && (
            <button onClick={() => setForm((f) => ({ ...f, cardName: '' }))} className="absolute top-3 right-3" style={{ color: 'var(--text-dim)' }} aria-label="Clear card name">
              <Icon name="x" size={16} />
            </button>
          )}
        </div>
      </Field>

      <Field label="Grade" required>
        <div className="flex gap-2 items-center">
          <div className="flex-1">
            <Select value={form.grade} onChange={(e) => setForm((f) => ({ ...f, grade: e.target.value }))}>
              {GRADES.map((g) => <option key={g} value={g}>{g === 'Authentic' ? 'Authentic' : `PSA ${g}`}</option>)}
            </Select>
          </div>
          {form.gradeLabel && (
            <span className="text-xs font-semibold px-3 py-2 rounded-lg shrink-0" style={{ background: 'rgba(63,163,93,0.15)', color: 'var(--green)' }}>{form.gradeLabel}</span>
          )}
        </div>
      </Field>

      <Field label="Cost (USD)">
        <div className="relative">
          <TextInput inputMode="decimal" placeholder="0.00" value={form.cost} onChange={set('cost')} className="pr-9" />
          <span className="absolute top-1/2 right-4 -translate-y-1/2 text-sm font-semibold" style={{ color: 'var(--text-dim)' }}>$</span>
        </div>
      </Field>

      <Field label="Source">
        {sourceOther ? (
          <div className="flex gap-2">
            <TextInput value={form.source} onChange={set('source')} className="flex-1" />
            <button onClick={() => { setSourceOther(false); setForm((f) => ({ ...f, source: '' })); }} className="shrink-0 rounded-lg px-3 text-xs font-semibold" style={{ background: 'var(--surface2)', color: 'var(--text-dim)', border: '1px solid var(--border)' }}>List</button>
          </div>
        ) : (
          <Select value={SOURCE_PRESETS.includes(form.source) ? form.source : ''} onChange={(e) => {
            if (e.target.value === 'Other') { setSourceOther(true); setForm((f) => ({ ...f, source: '' })); }
            else setForm((f) => ({ ...f, source: e.target.value }));
          }}>
            <option value="" disabled>Select a source…</option>
            {SOURCE_PRESETS.map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
        )}
      </Field>

      <Field label="Notes (optional)">
        <textarea style={inputStyle} rows={3} maxLength={200} className="w-full rounded-lg px-4 py-3 text-base focus:outline-none" value={form.notes} onChange={set('notes')} />
        <p className="text-[11px] text-right mt-1" style={{ color: 'var(--text-dim)' }}>{form.notes.length}/200</p>
      </Field>

      <Field label="Tags">
        <div className="flex flex-wrap gap-2 items-center">
          {form.tags.map((t) => (
            <span key={t} className="text-xs font-semibold px-3 py-1.5 rounded-full flex items-center gap-1.5" style={{ background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)' }}>
              {t}
              <button onClick={() => removeTag(t)} aria-label={`Remove tag ${t}`}><Icon name="x" size={12} /></button>
            </span>
          ))}
          {addingTag ? (
            <input autoFocus value={tagInput} onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addTag(); if (e.key === 'Escape') { setAddingTag(false); setTagInput(''); } }}
              onBlur={addTag} placeholder="Tag name"
              style={inputStyle} className="rounded-full px-3 py-1.5 text-xs w-28 focus:outline-none" />
          ) : (
            <button onClick={() => setAddingTag(true)} className="text-xs font-semibold px-3 py-1.5 rounded-full flex items-center gap-1" style={{ color: 'var(--gold)', border: '1px dashed var(--gold)' }}>
              <Icon name="plus" size={12} /> Add Tag
            </button>
          )}
        </div>
      </Field>

      <Btn onClick={handleSave} disabled={!canSave} className="mt-2"><Icon name="save" size={18} /> {editingItem ? 'Save changes' : 'Save Slab'}</Btn>

      {!editingItem && <QuickTips />}

      <div className="rounded-lg p-3 mt-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <p className="text-sm font-semibold mb-3" style={{ color: 'var(--text)' }}>Card photo</p>
        {photoDataUrl ? (
          <div className="relative mb-3">
            <img src={photoDataUrl} alt="Card preview" className="w-full rounded-lg" style={{ maxHeight: 220, objectFit: 'contain', background: 'var(--surface2)' }} />
            <button onClick={() => setPhotoDataUrl(null)} className="absolute top-2 right-2 rounded-full p-1.5" style={{ background: 'rgba(0,0,0,0.6)' }} aria-label="Remove photo">
              <Icon name="x" size={16} style={{ color: '#fff' }} />
            </button>
          </div>
        ) : null}
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => photoCameraRef.current?.click()} className="rounded-lg px-3 py-2.5 flex items-center justify-center gap-1.5 text-sm font-semibold" style={{ background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)' }}>
            <Icon name="camera" size={16} /> {photoDataUrl ? 'Retake' : 'Take Photo'}
          </button>
          <button onClick={() => photoLibraryRef.current?.click()} className="rounded-lg px-3 py-2.5 flex items-center justify-center gap-1.5 text-sm font-semibold" style={{ background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)' }}>
            <Icon name="image" size={16} /> Upload Photo
          </button>
        </div>
        <input ref={photoCameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleCardPhoto} />
        <input ref={photoLibraryRef} type="file" accept="image/*" className="hidden" onChange={handleCardPhoto} />
      </div>

      {scanning && <ScannerModal onDetect={(val) => { setForm((f) => ({ ...f, certNumber: val })); setScanning(false); runPsaLookup(val); }} onClose={() => setScanning(false)} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Inventory Search + detail                                           */
/* ------------------------------------------------------------------ */

function Row({ label, value, valueColor }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-sm" style={{ color: 'var(--text-dim)' }}>{label}</span>
      <span className="text-sm font-semibold tabular-nums" style={{ color: valueColor || 'var(--text)' }}>{value}</span>
    </div>
  );
}

function ItemDetail({ item, onClose, onEdit, onDelete, onGoSell, onGoTrade, onRevert }) {
  const [photo, setPhoto] = useState(null);
  useEffect(() => {
    let cancelled = false;
    loadPhoto(item.id).then((p) => { if (!cancelled) setPhoto(p); });
    return () => { cancelled = true; };
  }, [item.id]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col" style={{ background: 'var(--bg)' }}>
      <div className="flex items-center justify-between px-4 py-3" style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
        <button onClick={onClose} className="flex items-center gap-1" style={{ color: 'var(--text)' }}><Icon name="arrowLeft" size={20} /> Back</button>
        <StatusBadge status={item.status} />
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="rounded-xl overflow-hidden mb-4" style={{ border: '1px solid var(--border)' }}>
          <div className="px-4 py-3" style={{ background: 'var(--accent)' }}>
            <span className="text-[10px] font-bold tracking-widest text-white/80">PSA GRADE</span>
            <div className="font-display text-4xl font-bold text-white leading-none mt-1">{item.grade}</div>
          </div>
          <div className="px-4 py-3" style={{ background: 'var(--surface)' }}>
            <div className="flex items-start justify-between gap-2">
              <p className="font-semibold text-lg" style={{ color: 'var(--text)' }}>{item.cardName}</p>
              {item.gradeLabel && <span className="text-xs font-semibold px-2 py-1 rounded shrink-0" style={{ background: 'rgba(63,163,93,0.15)', color: 'var(--green)' }}>{item.gradeLabel}</span>}
            </div>
            <p className="font-mono text-sm mt-1" style={{ color: 'var(--text-dim)' }}>CERT #{item.certNumber}</p>
          </div>
        </div>

        {item.tags && item.tags.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-4">
            {item.tags.map((t) => (
              <span key={t} className="text-xs font-semibold px-3 py-1.5 rounded-full" style={{ background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)' }}>{t}</span>
            ))}
          </div>
        )}

        {photo && (
          <div className="rounded-xl overflow-hidden mb-4" style={{ border: '1px solid var(--border)' }}>
            <img src={photo} alt={item.cardName} style={{ width: '100%', display: 'block', background: 'var(--surface2)' }} />
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="rounded-lg p-3" style={{ background: 'var(--surface)' }}><p className="text-xs" style={{ color: 'var(--text-dim)' }}>Cost</p><p className="font-semibold text-lg" style={{ color: 'var(--text)' }}>{money(item.cost)}</p></div>
          <div className="rounded-lg p-3" style={{ background: 'var(--surface)' }}><p className="text-xs" style={{ color: 'var(--text-dim)' }}>Added</p><p className="font-semibold text-lg" style={{ color: 'var(--text)' }}>{shortDate(item.dateAdded)}</p></div>
          <div className="rounded-lg p-3 col-span-2" style={{ background: 'var(--surface)' }}><p className="text-xs" style={{ color: 'var(--text-dim)' }}>Source</p><p className="font-semibold" style={{ color: 'var(--text)' }}>{item.source || '—'}</p></div>
          {item.notes && <div className="rounded-lg p-3 col-span-2" style={{ background: 'var(--surface)' }}><p className="text-xs mb-1" style={{ color: 'var(--text-dim)' }}>Notes</p><p className="text-sm" style={{ color: 'var(--text)' }}>{item.notes}</p></div>}
        </div>

        {item.status === 'Sold' && item.sale && (
          <div className="rounded-lg p-3 mb-4" style={{ background: 'rgba(201,162,75,0.1)', border: '1px solid var(--gold)' }}>
            <p className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: 'var(--gold)' }}>Sale details</p>
            <Row label="Sale amount" value={money(item.sale.amount)} />
            <Row label="Payment medium" value={item.sale.medium} />
            <Row label="Fees" value={money(item.sale.feeAmount)} />
            <Row label="Net profit" value={money(item.sale.netProfit)} valueColor={item.sale.netProfit >= 0 ? 'var(--green)' : 'var(--danger)'} />
            <Row label="Date" value={shortDate(item.sale.date)} />
          </div>
        )}
        {item.status === 'Traded' && item.trade && (
          <div className="rounded-lg p-3 mb-4" style={{ background: 'rgba(154,180,240,0.1)', border: '1px solid #9AB4F0' }}>
            <p className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: '#9AB4F0' }}>Trade details</p>
            <Row label="Received" value={item.trade.received} />
            <Row label="Estimated value" value={money(item.trade.estimatedValue)} />
            <Row label="Gain / loss vs cost" value={money(item.trade.gainLoss)} valueColor={item.trade.gainLoss >= 0 ? 'var(--green)' : 'var(--danger)'} />
            <Row label="Date" value={shortDate(item.trade.date)} />
          </div>
        )}

        <div className="flex flex-col gap-2 mt-2">
          {item.status === 'In Inventory' && (
            <div className="grid grid-cols-2 gap-2">
              <Btn variant="primary" onClick={() => onGoSell(item)}><Icon name="dollar" size={16} /> Sell</Btn>
              <Btn variant="ghost" onClick={() => onGoTrade(item)}><Icon name="repeat" size={16} /> Trade</Btn>
            </div>
          )}
          <Btn variant="ghost" onClick={() => window.open(ebaySoldSearchUrl(item), '_blank')}><Icon name="external" size={16} /> Check eBay sold comps</Btn>
          {item.status !== 'In Inventory' && <Btn variant="ghost" onClick={() => onRevert(item)}>Revert to In Inventory</Btn>}
          <Btn variant="ghost" onClick={() => onEdit(item)}><Icon name="edit" size={16} /> Edit details</Btn>
          <Btn variant="danger" onClick={() => onDelete(item)}><Icon name="trash" size={16} /> Delete</Btn>
        </div>
      </div>
    </div>
  );
}

function SearchScreen({ items, onEdit, onDelete, onGoSell, onGoTrade, onRevert, onExport }) {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('All');
  const [selected, setSelected] = useState(null);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return items
      .filter((it) => status === 'All' || it.status === status)
      .filter((it) => !query || it.certNumber.toLowerCase().includes(query) || it.cardName.toLowerCase().includes(query) || (it.source || '').toLowerCase().includes(query))
      .sort((a, b) => new Date(b.dateAdded) - new Date(a.dateAdded));
  }, [items, q, status]);

  return (
    <div className="px-4 pt-4 pb-28">
      <div className="flex items-center justify-between mb-4">
        <h1 className="font-display text-2xl font-bold" style={{ color: 'var(--text)' }}>Inventory</h1>
        <button onClick={onExport} className="flex items-center gap-1 text-xs font-semibold px-3 py-2 rounded-lg" style={{ background: 'var(--surface2)', color: 'var(--text-dim)', border: '1px solid var(--border)' }}>
          <Icon name="download" size={14} /> CSV
        </button>
      </div>

      <div className="relative mb-3">
        <span className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-dim)' }}><Icon name="search" size={18} /></span>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search cert #, card name, source..." style={inputStyle} className="w-full rounded-lg pl-10 pr-4 py-3.5 text-base focus:outline-none" />
      </div>

      <div className="flex gap-2 mb-4 overflow-x-auto">
        {['All', 'In Inventory', 'Sold', 'Traded'].map((s) => (
          <button key={s} onClick={() => setStatus(s)} className="shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold"
            style={{ background: status === s ? 'var(--gold)' : 'var(--surface2)', color: status === s ? '#1a1305' : 'var(--text-dim)', border: '1px solid var(--border)' }}>
            {s}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-16">
          <Icon name="package" size={32} style={{ color: 'var(--text-dim)' }} className="mx-auto mb-2" />
          <p style={{ color: 'var(--text-dim)' }}>{items.length === 0 ? 'No slabs yet — add your first one.' : 'Nothing matches that search.'}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">{filtered.map((it) => <SlabChip key={it.id} item={it} onClick={() => setSelected(it)} />)}</div>
      )}

      {selected && (
        <ItemDetail item={selected} onClose={() => setSelected(null)}
          onEdit={(it) => { onEdit(it); setSelected(null); }}
          onDelete={(it) => { onDelete(it); setSelected(null); }}
          onGoSell={(it) => { onGoSell(it); setSelected(null); }}
          onGoTrade={(it) => { onGoTrade(it); setSelected(null); }}
          onRevert={(it) => { onRevert(it); setSelected(null); }} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Item picker for Sell / Trade                                        */
/* ------------------------------------------------------------------ */

function ItemPicker({ items, onPick }) {
  const [q, setQ] = useState('');
  const pool = items.filter((it) => it.status === 'In Inventory');
  const filtered = q.trim() ? pool.filter((it) => it.cardName.toLowerCase().includes(q.toLowerCase()) || it.certNumber.includes(q)) : pool;

  return (
    <div className="mb-4">
      <div className="relative mb-3">
        <span className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-dim)' }}><Icon name="search" size={18} /></span>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a slab from inventory..." style={inputStyle} className="w-full rounded-lg pl-10 pr-4 py-3.5 text-base focus:outline-none" />
      </div>
      {pool.length === 0 ? <p className="text-sm py-6 text-center" style={{ color: 'var(--text-dim)' }}>Nothing in inventory to select yet.</p> : (
        <div className="flex flex-col gap-2 max-h-80 overflow-y-auto">{filtered.map((it) => <SlabChip key={it.id} item={it} onClick={() => onPick(it)} />)}</div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sell / Trade screens                                                */
/* ------------------------------------------------------------------ */

function SellScreen({ items, presetItem, clearPreset, onComplete, notify }) {
  const [item, setItem] = useState(presetItem || null);
  const [amount, setAmount] = useState('');
  const [medium, setMedium] = useState(PAYMENT_MEDIUMS[0]);
  const [feeType, setFeeType] = useState('flat');
  const [feeValue, setFeeValue] = useState('');

  useEffect(() => { if (presetItem) setItem(presetItem); }, [presetItem]);

  const saleAmount = parseFloat(amount) || 0;
  const feeAmount = feeType === 'percent' ? saleAmount * ((parseFloat(feeValue) || 0) / 100) : (parseFloat(feeValue) || 0);
  const netProfit = item ? saleAmount - feeAmount - (item.cost || 0) : 0;
  const reset = () => { setItem(null); setAmount(''); setMedium(PAYMENT_MEDIUMS[0]); setFeeType('flat'); setFeeValue(''); clearPreset(); };

  const submit = async () => {
    if (!item || !amount) return;
    await onComplete({ ...item, status: 'Sold', sale: { amount: saleAmount, medium, feeType, feeValue: parseFloat(feeValue) || 0, feeAmount, netProfit, date: todayISO() } });
    notify('Marked sold');
    reset();
  };

  return (
    <div className="px-4 pt-4 pb-28">
      <h1 className="font-display text-2xl font-bold mb-4" style={{ color: 'var(--text)' }}>Sell Item</h1>
      {!item && <ItemPicker items={items} onPick={setItem} />}
      {item && (
        <>
          <div className="mb-4 flex items-center gap-2">
            <div className="flex-1"><SlabChip item={item} onClick={() => {}} /></div>
            <button onClick={reset} className="text-xs font-semibold px-2 py-1 rounded" style={{ color: 'var(--text-dim)' }}>Change</button>
          </div>
          <Field label="Sale amount" required><TextInput inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus /></Field>
          <Field label="Payment medium"><Select value={medium} onChange={(e) => setMedium(e.target.value)}>{PAYMENT_MEDIUMS.map((m) => <option key={m} value={m}>{m}</option>)}</Select></Field>
          <Field label="Fees">
            <div className="flex gap-2">
              <TextInput inputMode="decimal" placeholder="0.00" value={feeValue} onChange={(e) => setFeeValue(e.target.value)} className="flex-1" />
              <div className="flex rounded-lg overflow-hidden shrink-0" style={{ border: '1px solid var(--border)' }}>
                {['flat', 'percent'].map((t) => (
                  <button key={t} onClick={() => setFeeType(t)} className="px-3 text-sm font-semibold" style={{ background: feeType === t ? 'var(--gold)' : 'var(--surface2)', color: feeType === t ? '#1a1305' : 'var(--text-dim)' }}>{t === 'flat' ? '$' : '%'}</button>
                ))}
              </div>
            </div>
          </Field>
          <div className="rounded-lg p-4 mb-5" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <Row label="Sale amount" value={money(saleAmount)} />
            <Row label="Fees" value={`- ${money(feeAmount)}`} />
            <Row label="Cost basis" value={`- ${money(item.cost)}`} />
            <div className="h-px my-2" style={{ background: 'var(--border)' }} />
            <Row label="Net profit" value={money(netProfit)} valueColor={netProfit >= 0 ? 'var(--green)' : 'var(--danger)'} />
          </div>
          <Btn onClick={submit} disabled={!amount}><Icon name="check" size={18} /> Confirm sale</Btn>
        </>
      )}
    </div>
  );
}

function TradeScreen({ items, presetItem, clearPreset, onComplete, notify }) {
  const [item, setItem] = useState(presetItem || null);
  const [received, setReceived] = useState('');
  const [estValue, setEstValue] = useState('');
  useEffect(() => { if (presetItem) setItem(presetItem); }, [presetItem]);
  const est = parseFloat(estValue) || 0;
  const gainLoss = item ? est - (item.cost || 0) : 0;
  const reset = () => { setItem(null); setReceived(''); setEstValue(''); clearPreset(); };

  const submit = async () => {
    if (!item || !received) return;
    await onComplete({ ...item, status: 'Traded', trade: { received, estimatedValue: est, gainLoss, date: todayISO() } });
    notify('Marked traded');
    reset();
  };

  return (
    <div className="px-4 pt-4 pb-28">
      <h1 className="font-display text-2xl font-bold mb-4" style={{ color: 'var(--text)' }}>Trade Item</h1>
      {!item && <ItemPicker items={items} onPick={setItem} />}
      {item && (
        <>
          <div className="mb-4 flex items-center gap-2">
            <div className="flex-1"><SlabChip item={item} onClick={() => {}} /></div>
            <button onClick={reset} className="text-xs font-semibold px-2 py-1 rounded" style={{ color: 'var(--text-dim)' }}>Change</button>
          </div>
          <Field label="What you received" required><TextInput value={received} onChange={(e) => setReceived(e.target.value)} autoFocus /></Field>
          <Field label="Estimated value received"><TextInput inputMode="decimal" placeholder="0.00" value={estValue} onChange={(e) => setEstValue(e.target.value)} /></Field>
          <div className="rounded-lg p-4 mb-5" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <Row label="Estimated value in" value={money(est)} />
            <Row label="Cost basis" value={`- ${money(item.cost)}`} />
            <div className="h-px my-2" style={{ background: 'var(--border)' }} />
            <Row label="Implied gain / loss" value={money(gainLoss)} valueColor={gainLoss >= 0 ? 'var(--green)' : 'var(--danger)'} />
          </div>
          <Btn onClick={submit} disabled={!received}><Icon name="check" size={18} /> Confirm trade</Btn>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Show Mode                                                           */
/* ------------------------------------------------------------------ */

function ScoreCard({ label, value, highlight, small }) {
  return (
    <div className="rounded-lg py-3 px-2 text-center shadow-card" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
      <p className={`font-display font-bold tabular-nums ${small ? 'text-lg' : 'text-2xl'}`} style={{ color: highlight === false ? 'var(--danger)' : highlight === true ? 'var(--green)' : 'var(--text)' }}>{value}</p>
      <p className="text-[10px] uppercase tracking-wide mt-0.5" style={{ color: 'var(--text-dim)' }}>{label}</p>
    </div>
  );
}

function BigButton({ iconName, label, onClick, color, textColor }) {
  return (
    <button onClick={onClick} className="rounded-xl py-5 flex flex-col items-center justify-center gap-1.5 active:scale-[0.97] transition-transform shadow-card" style={{ background: color, color: textColor }}>
      <Icon name={iconName} size={26} /><span className="font-semibold text-sm">{label}</span>
    </button>
  );
}

function ShowModeScreen({ items, onNav }) {
  const now = new Date();
  const todaysSales = items.filter((it) => it.status === 'Sold' && isSameDay(it.sale?.date, now));
  const todaysTrades = items.filter((it) => it.status === 'Traded' && isSameDay(it.trade?.date, now));
  const todaysProfit = todaysSales.reduce((s, it) => s + (it.sale?.netProfit || 0), 0);
  const inInventoryCount = items.filter((it) => it.status === 'In Inventory').length;
  const invested = items.filter((it) => it.status === 'In Inventory').reduce((s, it) => s + (it.cost || 0), 0);

  return (
    <div className="px-4 pt-4 pb-28">
      <h1 className="font-display text-2xl font-bold mb-1" style={{ color: 'var(--text)' }}>Show Mode</h1>
      <p className="text-sm mb-5" style={{ color: 'var(--text-dim)' }}>{now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</p>
      <div className="grid grid-cols-3 gap-2 mb-6">
        <ScoreCard label="Sold today" value={todaysSales.length} />
        <ScoreCard label="Traded today" value={todaysTrades.length} />
        <ScoreCard label="Profit today" value={money(todaysProfit)} highlight={todaysProfit >= 0} small />
      </div>
      <div className="flex flex-col gap-3 mb-6">
        <BigButton iconName="plus" label="Add Slab" onClick={() => onNav('add')} color="var(--gold)" textColor="#1a1305" />
        <BigButton iconName="search" label="Find in Inventory" onClick={() => onNav('search')} color="var(--surface2)" textColor="var(--text)" />
        <div className="grid grid-cols-2 gap-3">
          <BigButton iconName="dollar" label="Sell" onClick={() => onNav('sell')} color="var(--surface2)" textColor="var(--text)" />
          <BigButton iconName="repeat" label="Trade" onClick={() => onNav('trade')} color="var(--surface2)" textColor="var(--text)" />
        </div>
      </div>
      <div className="rounded-lg p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <p className="text-xs uppercase tracking-wider mb-2" style={{ color: 'var(--text-dim)' }}>Box status</p>
        <Row label="Slabs on hand" value={inInventoryCount} />
        <Row label="Capital invested" value={money(invested)} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Settings — PSA API token                                            */
/* ------------------------------------------------------------------ */

function SettingsScreen({ psaToken, onSaveToken, notify, theme, onChangeTheme }) {
  const [value, setValue] = useState(psaToken || '');
  const save = async () => { await onSaveToken(value.trim()); notify(value.trim() ? 'PSA token saved' : 'PSA token cleared'); };

  return (
    <div className="px-4 pt-4 pb-28">
      <h1 className="font-display text-2xl font-bold mb-4" style={{ color: 'var(--text)' }}>Settings</h1>

      <div className="rounded-lg p-4 mb-4 shadow-card" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <p className="text-sm font-semibold mb-3" style={{ color: 'var(--text)' }}>Appearance</p>
        <div className="flex rounded-lg overflow-hidden" style={{ border: '1px solid var(--border)' }}>
          {[{ id: 'dark', label: 'Dark', icon: 'zap' }, { id: 'light', label: 'Light', icon: 'lightbulb' }].map((opt) => (
            <button key={opt.id} onClick={() => onChangeTheme(opt.id)}
              className="flex-1 py-2.5 flex items-center justify-center gap-1.5 text-sm font-semibold"
              style={{ background: theme === opt.id ? 'var(--gold)' : 'var(--surface2)', color: theme === opt.id ? '#1a1305' : 'var(--text-dim)' }}>
              <Icon name={opt.icon} size={15} /> {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-lg p-4 mb-4 shadow-card" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <p className="text-sm font-semibold mb-2" style={{ color: 'var(--text)' }}>PSA API token</p>
        <p className="text-xs mb-3" style={{ color: 'var(--text-dim)' }}>
          Used to auto-fill card name and grade after a cert-number scan. Get a free token by signing in at{' '}
          <span style={{ color: 'var(--gold)' }}>psacard.com/publicapi</span> — free accounts get 100 lookups/day. Stored only on this device.
        </p>
        <Field label="Access token">
          <textarea style={inputStyle} rows={3} className="w-full rounded-lg px-4 py-3 text-sm font-mono focus:outline-none" placeholder="Paste your PSA access token here" value={value} onChange={(e) => setValue(e.target.value)} />
        </Field>
        <Btn onClick={save}><Icon name="check" size={16} /> Save token</Btn>
      </div>
      <div className="rounded-lg p-4 shadow-card" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <p className="text-sm font-semibold mb-1" style={{ color: 'var(--text)' }}>About this app</p>
        <p className="text-xs" style={{ color: 'var(--text-dim)' }}>Slab Ledger stores everything locally on this device (IndexedDB) — nothing syncs to a server. Use the CSV export on the Inventory screen to back up or move your data.</p>
      </div>
    </div>
  );
}


/* ------------------------------------------------------------------ */
/* App shell                                                           */
/* ------------------------------------------------------------------ */

const TABS = [
  { id: 'add', label: 'Add', icon: 'plus' },
  { id: 'search', label: 'Search', icon: 'search' },
  { id: 'sell', label: 'Sell', icon: 'dollar' },
  { id: 'trade', label: 'Trade', icon: 'repeat' },
  { id: 'show', label: 'Show', icon: 'zap' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
];

function App() {
  const [items, setItems] = useState([]);
  const [psaToken, setPsaToken] = useState('');
  const [theme, setThemeState] = useState('dark');
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('add');
  const [editingItem, setEditingItem] = useState(null);
  const [presetSell, setPresetSell] = useState(null);
  const [presetTrade, setPresetTrade] = useState(null);
  const [toast, setToast] = useState('');

  useEffect(() => {
    Promise.all([loadInventory(), loadToken(), loadTheme()]).then(([inv, token, savedTheme]) => {
      setItems(inv); setPsaToken(token);
      const initialTheme = savedTheme || (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
      setThemeState(initialTheme);
      applyThemeColorMeta(initialTheme);
      setLoading(false);
    });
  }, []);

  const changeTheme = useCallback(async (next) => {
    setThemeState(next);
    applyThemeColorMeta(next);
    await saveTheme(next);
  }, []);

  const notify = useCallback((text) => { setToast(text); setTimeout(() => setToast(''), 1800); }, []);

  const persist = async (next) => { setItems(next); await saveInventory(next); };
  const addOrUpdate = async (item) => {
    const exists = items.some((it) => it.id === item.id);
    const next = exists ? items.map((it) => (it.id === item.id ? item : it)) : [item, ...items];
    await persist(next);
  };
  const deleteItem = async (item) => {
    if (!window.confirm(`Delete ${item.cardName || 'this slab'}? This can't be undone.`)) return;
    await persist(items.filter((it) => it.id !== item.id));
    await savePhoto(item.id, null);
    notify('Deleted');
  };
  const revertItem = async (item) => { await addOrUpdate({ ...item, status: 'In Inventory', sale: null, trade: null }); notify('Reverted to inventory'); };
  const saveTokenHandler = async (token) => { setPsaToken(token); await saveToken(token); };

  const exportCSV = () => {
    const headers = ['Cert Number', 'Card Name', 'Grade', 'Cost', 'Source', 'Notes', 'Status', 'Date Added', 'Sale Amount', 'Payment Medium', 'Fees', 'Net Profit', 'Sale Date', 'Trade Received', 'Trade Est. Value', 'Trade Gain/Loss', 'Trade Date'];
    const rows = items.map((it) => [
      it.certNumber, it.cardName, it.grade, it.cost, it.source, (it.notes || '').replace(/\n/g, ' '), it.status, shortDate(it.dateAdded),
      it.sale?.amount ?? '', it.sale?.medium ?? '', it.sale?.feeAmount ?? '', it.sale?.netProfit ?? '', it.sale ? shortDate(it.sale.date) : '',
      it.trade?.received ?? '', it.trade?.estimatedValue ?? '', it.trade?.gainLoss ?? '', it.trade ? shortDate(it.trade.date) : '',
    ]);
    const csv = [headers, ...rows].map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `slab-inventory-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
    URL.revokeObjectURL(url);
    notify('CSV exported');
  };

  const goSell = (item) => { setPresetSell(item); setTab('sell'); };
  const goTrade = (item) => { setPresetTrade(item); setTab('trade'); };
  const stats = useMemo(() => ({ total: items.length, inInv: items.filter((it) => it.status === 'In Inventory').length }), [items]);

  if (loading) {
    return (
      <div className="min-h-screen px-4 pt-6" data-theme={theme} style={{ background: 'var(--bg)' }}>
        <div className="skeleton h-6 mb-6" style={{ width: '40%' }} />
        <div className="skeleton h-16 mb-3" />
        <div className="skeleton h-16 mb-3" />
        <div className="skeleton h-16 mb-3" style={{ width: '80%' }} />
      </div>
    );
  }

  return (
    <div className="min-h-screen" data-theme={theme} style={{ background: 'var(--bg)', fontFamily: 'Inter, sans-serif' }}>
      <Toast text={toast} />
      <header className="sticky top-0 z-30 px-4 py-3 flex items-center justify-between header-blur" style={{ borderBottom: '1px solid var(--border)' }}>
        <div className="flex items-center gap-2">
          <LogoMark size={24} />
          <h1 className="font-display text-xl font-bold tracking-wide" style={{ color: 'var(--text)' }}>SLAB LEDGER</h1>
        </div>
        <p className="text-xs" style={{ color: 'var(--text-dim)' }}>{stats.inInv} on hand · {stats.total} total</p>
      </header>
      <main key={tab} className="screen-fade">
        {tab === 'add' && <AddSlabScreen editingItem={editingItem} onSaved={addOrUpdate} onCancelEdit={() => setEditingItem(null)} notify={notify} psaToken={psaToken} items={items} />}
        {tab === 'search' && <SearchScreen items={items} onEdit={(it) => { setEditingItem(it); setTab('add'); }} onDelete={deleteItem} onGoSell={goSell} onGoTrade={goTrade} onRevert={revertItem} onExport={exportCSV} />}
        {tab === 'sell' && <SellScreen items={items} presetItem={presetSell} clearPreset={() => setPresetSell(null)} onComplete={addOrUpdate} notify={notify} />}
        {tab === 'trade' && <TradeScreen items={items} presetItem={presetTrade} clearPreset={() => setPresetTrade(null)} onComplete={addOrUpdate} notify={notify} />}
        {tab === 'show' && <ShowModeScreen items={items} onNav={setTab} />}
        {tab === 'settings' && <SettingsScreen psaToken={psaToken} onSaveToken={saveTokenHandler} notify={notify} theme={theme} onChangeTheme={changeTheme} />}
      </main>
      <nav className="fixed bottom-0 inset-x-0 z-30 flex nav-blur nav-safe-pad" style={{ borderTop: '1px solid var(--border)' }}>
        {TABS.map(({ id, label, icon }) => {
          const active = tab === id;
          return (
            <button key={id} onClick={() => { setTab(id); if (id !== 'add') setEditingItem(null); }}
              className="flex-1 flex flex-col items-center gap-1 pt-2"
              style={{ color: active ? 'var(--gold)' : 'var(--text-dim)' }}>
              <span className="rounded-full flex items-center justify-center" style={{ width: 30, height: 30, background: active ? 'var(--gold)' : 'transparent' }}>
                <Icon name={icon} size={18} style={{ color: active ? '#1a1305' : 'var(--text-dim)' }} />
              </span>
              <span className="text-[11px] font-semibold">{label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
