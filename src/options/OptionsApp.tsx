import { useEffect, useMemo, useRef, useState } from 'react';
import { TranslationSettings } from './TranslationSettings';
import { DEFAULT_PRODUCT_KEYWORDS, newKeyword, type BusinessData, type Config, type PaymentMethod, type Product, type ProductImage, type ReplyCategory, type ReplyKeyword, type ReplyLanguage } from '@/shared/types';
import { loadBusinessData, loadConfig, saveBusinessData, saveConfig } from '@/shared/storage';
import { validGroupUrl } from '@/shared/business-replies';

const TABS = [
  ['settings', '设置'], ['product', '商品'], ['payment', '支付方式'],
  ['shipping', '物流'], ['trust', '信任与保障'], ['auto', '自动回复'],
] as const;
const CATEGORY_NAMES: Record<ReplyCategory, string> = { product: '商品信息', payment: '支付方式', shipping: '物流与时效', trust: '信任与保障' };

export function OptionsApp() {
  const [config, setConfig] = useState<Config | null>(null);
  const [data, setData] = useState<BusinessData | null>(null);
  const [status, setStatus] = useState<{ tone: 'ok' | 'err' | ''; text: string }>({ tone: '', text: '' });
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Product | null>(null);
  const [adding, setAdding] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [selectedSuggestions, setSelectedSuggestions] = useState<string[]>([]);
  const [keywordDraft, setKeywordDraft] = useState('');
  const dataRef = useRef<BusinessData | null>(null);
  const saveQueue = useRef<Promise<unknown>>(Promise.resolve());
  const [generatingKeywords, setGeneratingKeywords] = useState(false);
  const editingRef = useRef<Product | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => { editingRef.current = editing; }, [editing]);
  useEffect(() => () => { if (flashTimer.current) clearTimeout(flashTimer.current); }, []);

  useEffect(() => {
    Promise.all([loadConfig(), loadBusinessData()]).then(([c, b]) => { setConfig(c); setData(b); dataRef.current = b; })
      .catch(() => setStatus({ tone: 'err', text: '读取配置失败，请重新打开设置。' }));
  }, []);

  const activeTab = data?.activeTab ?? 'settings';
  const setAndSaveConfig = useMemo(() => (patch: Partial<Config>) => {
    setConfig((prev) => prev ? { ...prev, ...patch } : prev);
    saveConfig(patch).then(() => flash('保存成功')).catch(() => flash('保存失败，请重试', true));
  }, []);

  const updateBusiness = (updater: (prev: BusinessData) => BusinessData) => {
    const previous = dataRef.current;
    if (!previous) return Promise.resolve(false);
    const next = updater(previous);
    dataRef.current = next;
    setData(next);
    const operation = saveQueue.current.then(() => saveBusinessData(next));
    saveQueue.current = operation.catch(() => {});
    return operation.then(() => { flash('已保存'); return true; }, () => { flash('保存失败，数据未写入，请重试', true); return false; });
  };
  const flash = (text: string, error = false) => {
    if (flashTimer.current) clearTimeout(flashTimer.current);
    setStatus({ tone: error ? 'err' : 'ok', text });
    if (!error) flashTimer.current = setTimeout(() => setStatus({ tone: '', text: '' }), 1800);
  };

  if (!config || !data) return <div className="opts-shell">Loading…</div>;

  const setTab = (tab: string) => {
    if (editing && !window.confirm('商品编辑尚未保存，切换标签会丢弃这些修改。继续吗？')) return;
    setEditing(null); setAdding(false); setSuggestions([]); setKeywordDraft('');
    void updateBusiness((prev) => ({ ...prev, activeTab: tab }));
  };
  const addKeyword = (category: ReplyCategory, text: string) => {
    if (!text.trim()) return;
    if (category === 'product' && editing) {
      if (editing.keywords.some((k) => k.text.toLowerCase() === text.trim().toLowerCase())) { flash('已有相同关键词', true); return; }
      setEditing({ ...editing, keywords: [...editing.keywords, newKeyword(text)] });
      setKeywordDraft('');
      return;
    }
    if (category === 'product') return;
    const key = `${category}Keywords` as 'paymentKeywords' | 'shippingKeywords' | 'trustKeywords';
    if (data[key].some((k) => k.text.toLocaleLowerCase() === text.trim().toLocaleLowerCase())) { flash('已有相同关键词', true); return; }
    updateBusiness((prev) => {
      const arr = prev[key];
      if (arr.some((k) => k.text.toLowerCase() === text.trim().toLowerCase())) return prev;
      return { ...prev, [key]: [...arr, newKeyword(text)] };
    });
    setKeywordDraft('');
  };
  const updateKeyword = (category: ReplyCategory, keywordId: string, patch: Partial<ReplyKeyword>) => {
    if (category === 'product' && editing) {
      setEditing({ ...editing, keywords: editing.keywords.map((k) => k.id === keywordId ? { ...k, ...patch } : k) });
      return;
    }
    updateBusiness((prev) => {
      if (category === 'product') return prev;
      const key = `${category}Keywords` as 'paymentKeywords' | 'shippingKeywords' | 'trustKeywords';
      return { ...prev, [key]: prev[key].map((k) => k.id === keywordId ? { ...k, ...patch } : k) };
    });
  };

  const renderKeywords = (category: ReplyCategory, items: ReplyKeyword[]) => (
    <div className="opts-keywords">
      <div className="opts-keyword-list">
        {items.filter((keyword) => keyword.text).map((keyword) => <span key={keyword.id} className="opts-keyword" data-enabled={keyword.enabled}>
          <button type="button" className="opts-keyword-state" aria-pressed={keyword.enabled} title={keyword.enabled ? '停用关键词' : '启用关键词'} onClick={() => updateKeyword(category, keyword.id, { enabled: !keyword.enabled })}>{keyword.text}</button>
          <button type="button" className="opts-keyword-edit" aria-label={`修改${keyword.text}`} onClick={() => {
            const replacement = window.prompt('修改中文关键词', keyword.text)?.trim();
            if (!replacement) return;
            if (items.some((item) => item.id !== keyword.id && item.text.toLocaleLowerCase() === replacement.toLocaleLowerCase())) { flash('已有相同关键词', true); return; }
            updateKeyword(category, keyword.id, { text: replacement });
          }}>✎</button>
          <button type="button" className="opts-keyword-remove" aria-label={`删除${keyword.text}`} onClick={() => {
            if (category === 'product' && editing) {
              setEditing({ ...editing, keywords: editing.keywords.filter((k) => k.id !== keyword.id) });
              return;
            }
            updateBusiness((prev) => {
              if (category === 'product') return prev;
              const key = `${category}Keywords` as 'paymentKeywords' | 'shippingKeywords' | 'trustKeywords';
              return { ...prev, [key]: prev[key].filter((k) => k.id !== keyword.id) };
            });
          }}>×</button>
        </span>)}
      </div>
      <div className="opts-keyword-add"><input value={keywordDraft} onChange={(e) => setKeywordDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addKeyword(category, keywordDraft); } }} placeholder="输入中文关键词，按回车添加" /><button type="button" onClick={() => addKeyword(category, keywordDraft)}>添加</button></div>
    </div>
  );

  const languageSelect = (value: ReplyLanguage, onChange: (value: ReplyLanguage) => void) => <select value={value} onChange={(e) => onChange(e.target.value as ReplyLanguage)}><option value="zh-CN">中文（发送前翻译为西班牙语）</option><option value="es-MX">墨西哥西班牙语（原文发送）</option></select>;
  const saveProduct = async (product: Product) => {
    const duplicate = data.products.find((p) => p.id !== product.id && p.name.trim().toLocaleLowerCase() === product.name.trim().toLocaleLowerCase());
    if (duplicate && !window.confirm(`已有同名商品“${duplicate.name}”。仍要保存这条商品吗？`)) return;
    const saved = await updateBusiness((prev) => {
      const exists = prev.products.some((p) => p.id === product.id);
      return { ...prev, products: exists ? prev.products.map((p) => p.id === product.id ? product : p) : [...prev.products, product] };
    });
    if (!saved) return;
    setEditing(null); setAdding(false); setSuggestions([]); setSelectedSuggestions([]);
  };
  const newProduct = (): Product => ({ id: crypto.randomUUID(), name: '', model: '', description: '', price: '', currency: 'USD', images: [], coverImageId: '', keywords: DEFAULT_PRODUCT_KEYWORDS.map((text) => newKeyword(text, 'default')), enabled: true, updatedAt: Date.now() });
  const productItems = data.products.filter((p) => `${p.name} ${p.model}`.toLowerCase().includes(search.toLowerCase()));

  return <div className="opts-shell opts-shell-wide">
    <h1>WA Web Translate</h1>
    <p className="opts-sub">WhatsApp 外贸回复配置保存在当前浏览器。业务回复目标语言为墨西哥西班牙语。</p>
    <nav className="opts-tabs" aria-label="配置分类">{TABS.map(([id, label]) => <button key={id} type="button" aria-selected={activeTab === id} onClick={() => setTab(id)}>{label}</button>)}</nav>

    {activeTab === 'settings' && <TranslationSettings config={config} onSave={setAndSaveConfig} />}

    {activeTab === 'product' && <section className="opts-section opts-section-first"><div className="opts-heading"><div><h2>商品资料</h2><p className="opts-help">一条商品对应一个具体型号。商品回复目标为墨西哥西班牙语。</p></div><button className="opts-primary" disabled={Boolean(editing)} onClick={() => { setEditing(newProduct()); setAdding(true); setSuggestions([]); setKeywordDraft(''); }}>新建商品</button></div>
      <CategorySwitch enabled={data.autoReply.product} onChange={(enabled) => { void updateBusiness((p) => ({ ...p, autoReply: { ...p.autoReply, product: enabled } })); }} />
      <div className="opts-row"><label>所有商品的内容语言</label>{languageSelect(data.productLanguage, (value) => updateBusiness((p) => ({ ...p, productLanguage: value })))}</div>
      {(adding || editing) ? <ProductEditor key={editing!.id} product={editing!} onChange={setEditing} generating={generatingKeywords} onCancel={() => { setEditing(null); setAdding(false); setSuggestions([]); }} onSave={saveProduct} renderKeywords={renderKeywords} suggestions={suggestions} selectedSuggestions={selectedSuggestions} onSuggestionChange={setSelectedSuggestions} onGenerate={async () => {
        if (!editing?.name.trim() || generatingKeywords) { flash('请先填写商品名称', true); return; }
        setGeneratingKeywords(true);
        const requestedProduct = editing;
        setStatus({ tone: '', text: '正在生成关键词建议…' });
        try {
          const response = await chrome.runtime.sendMessage({ kind: 'GENERATE_KEYWORDS', payload: { name: editing.name, model: editing.model, description: editing.description } });
          if (!response?.ok) throw new Error(response?.error || '关键词生成失败');
          const current = editingRef.current;
          if (current?.id !== requestedProduct.id) return;
          if (current.name !== requestedProduct.name || current.model !== requestedProduct.model || current.description !== requestedProduct.description) {
            flash('商品资料已修改，请重新生成关键词建议', true); return;
          }
          setSuggestions(response.keywords); setSelectedSuggestions(response.keywords); flash('建议已生成，请确认后加入');
        } catch { flash('关键词建议失败，请检查 AI 服务配置', true); }
        finally { setGeneratingKeywords(false); }
      }} onApplySuggestions={() => {
        const current = editing!;
        const present = new Set(current.keywords.map((k) => k.text.toLowerCase()));
        const next = { ...current, keywords: [...current.keywords, ...selectedSuggestions.filter((s) => !present.has(s.toLowerCase())).map((s) => newKeyword(s, 'ai'))] };
        setEditing(next);
        setSuggestions([]); setSelectedSuggestions([]);
      }} /> : <>
        <div className="opts-search"><input aria-label="搜索商品" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索商品名称或型号" /></div>
        <div className="opts-product-list">{productItems.map((product) => <div className="opts-product-row" key={product.id}><div className="opts-product-thumb">{product.images.find((image) => image.id === product.coverImageId) ? <img src={product.images.find((image) => image.id === product.coverImageId)!.dataUrl} /> : <span>无图片</span>}</div><div className="opts-product-main"><strong>{product.name}</strong><span>型号：{product.model || '—'} · {product.price ? `${product.price} ${product.currency}` : '未填写价格'}</span><small>{product.keywords.filter((k) => k.enabled).length} 个启用关键词 · {product.enabled ? '已启用' : '已停用'}</small></div><button type="button" onClick={() => { setEditing(product); setAdding(false); setSuggestions([]); setKeywordDraft(''); }}>编辑</button><button type="button" className="opts-danger-link" onClick={() => { if (window.confirm(`确定删除“${product.name}”吗？`)) updateBusiness((p) => ({ ...p, products: p.products.filter((item) => item.id !== product.id) })); }}>删除</button></div>)}{productItems.length === 0 && <div className="opts-empty">{data.products.length ? '没有匹配的商品，请修改搜索条件。' : '还没有商品，点击“新建商品”添加第一条。'}</div>}</div>
      </>}
    </section>}

    {activeTab === 'payment' && <>
      <CategorySwitch enabled={data.autoReply.payment} onChange={(enabled) => updateBusiness((p) => ({ ...p, autoReply: { ...p.autoReply, payment: enabled } }))} />
      <section className="opts-section"><h2>支付关键词</h2>{renderKeywords('payment', data.paymentKeywords)}</section>
      <section className="opts-section"><div className="opts-heading"><div><h2>收款方式</h2><p className="opts-help">默认方式留空时不会发送；客户表示不方便时展示已填写的备用方式。</p></div><button className="opts-secondary" onClick={() => updateBusiness((p) => ({ ...p, paymentMethods: [...p.paymentMethods, { id: crypto.randomUUID(), name: '', content: '', isDefault: false, enabled: true }] }))}>添加方式</button></div>
        <div className="opts-row"><label>回复内容语言</label>{languageSelect(data.paymentLanguage, (value) => updateBusiness((p) => ({ ...p, paymentLanguage: value })))}</div>
        {data.paymentMethods.map((method) => <PaymentEditor key={method.id} method={method} onChange={(patch) => updateBusiness((p) => ({ ...p, paymentMethods: p.paymentMethods.map((m) => m.id === method.id ? { ...m, ...patch } : { ...m, isDefault: patch.isDefault ? false : m.isDefault }) }))} onDelete={() => updateBusiness((p) => ({ ...p, paymentMethods: p.paymentMethods.filter((m) => m.id !== method.id), ...(method.isDefault ? { paymentMethods: p.paymentMethods.filter((m) => m.id !== method.id).map((m, i) => ({ ...m, isDefault: i === 0 })) } : {}) }))} />)}
      </section>
    </>}

    {activeTab === 'shipping' && <>
      <CategorySwitch enabled={data.autoReply.shipping} onChange={(enabled) => updateBusiness((p) => ({ ...p, autoReply: { ...p.autoReply, shipping: enabled } }))} />
      <section className="opts-section"><h2>物流回复关键词</h2>{renderKeywords('shipping', data.shippingKeywords)}</section>
      <section className="opts-section"><h2>物流信息</h2><div className="opts-row"><label>回复内容语言</label>{languageSelect(data.shippingLanguage, (value) => updateBusiness((p) => ({ ...p, shippingLanguage: value })))}</div><TextField label="预计送达时间" value={data.shippingDays} onChange={(v) => updateBusiness((p) => ({ ...p, shippingDays: v }))} /><TextField label="物流方式" value={data.shippingMethod} onChange={(v) => updateBusiness((p) => ({ ...p, shippingMethod: v }))} /><TextField label="发货安排" value={data.dispatchText} onChange={(v) => updateBusiness((p) => ({ ...p, dispatchText: v }))} /><ReplyPreview language={data.shippingLanguage} text={data.shippingLanguage === 'zh-CN' ? `发货后预计送达时间：${data.shippingDays}\n物流方式：${data.shippingMethod}\n发货安排：${data.dispatchText}` : `Entrega estimada tras el envío: ${data.shippingDays}\nEnvío: ${data.shippingMethod}\n${data.dispatchText}`} /><div className="opts-help">物流单号和截图由你在 WhatsApp 中手动发送。</div></section>
    </>}

    {activeTab === 'trust' && <>
      <CategorySwitch enabled={data.autoReply.trust} onChange={(enabled) => updateBusiness((p) => ({ ...p, autoReply: { ...p.autoReply, trust: enabled } }))} />
      <section className="opts-section"><h2>信任与保障关键词</h2>{renderKeywords('trust', data.trustKeywords)}</section>
      <section className="opts-section"><h2>回复内容</h2><div className="opts-row"><label>回复内容语言</label>{languageSelect(data.trustLanguage, (value) => updateBusiness((p) => ({ ...p, trustLanguage: value })))}</div><div className="opts-row"><label htmlFor="trust-text">付款与发货说明</label><textarea id="trust-text" value={data.trustText} onChange={(e) => updateBusiness((p) => ({ ...p, trustText: e.target.value }))} /></div><div className="opts-row"><label htmlFor="group-url">客户体验群邀请链接（可选）</label><input id="group-url" type="text" value={data.customerGroupUrl} onChange={(e) => updateBusiness((p) => ({ ...p, customerGroupUrl: e.target.value }))} placeholder="https://chat.whatsapp.com/..." /></div><div className="opts-toggle"><input id="include-group" type="checkbox" checked={data.includeGroupInvite} onChange={(e) => updateBusiness((p) => ({ ...p, includeGroupInvite: e.target.checked }))} /><label htmlFor="include-group">在回复中附带客户群邀请</label></div><div className="opts-help">邀请文案会提示群成员可能看到彼此号码和群内发言，链接单独放在最后一行。</div>{data.includeGroupInvite && !validGroupUrl(data.customerGroupUrl) && <p className="opts-warning">请填写有效的 WhatsApp 群邀请链接，否则不会发送这类回复。</p>}<ReplyPreview language={data.trustLanguage} text={data.trustText} suffix={data.includeGroupInvite && validGroupUrl(data.customerGroupUrl) ? `Puedes visitar nuestro grupo de WhatsApp para conocer las experiencias de otros clientes. Al unirte, los miembros pueden ver tu número de teléfono y tus mensajes en el grupo. Únete solo si estás de acuerdo.\n${data.customerGroupUrl.trim()}` : ''} /></section>
    </>}

    {activeTab === 'auto' && <>
      <section className="opts-section opts-section-first"><h2>全局自动回复</h2><div className="opts-toggle opts-toggle-large"><input id="global-auto" type="checkbox" checked={data.globalAutoReply} onChange={(e) => {
        if (e.target.checked) {
          if (!window.confirm('自动发送消息可能导致 WhatsApp 限制账号。确认了解此风险并启用自动回复吗？')) return;
          updateBusiness((p) => ({ ...p, globalAutoReply: true, riskConfirmed: true }));
        } else updateBusiness((p) => ({ ...p, globalAutoReply: e.target.checked }));
      }} /><label htmlFor="global-auto">{data.globalAutoReply ? '自动回复已开启' : '自动回复已关闭'}</label></div><p className="opts-help">仅当全局开关和对应类别开关都开启时才会自动发送。可随时暂停。</p><button className="opts-secondary" onClick={() => updateBusiness((p) => ({ ...p, globalAutoReply: false }))}>一键暂停所有自动回复</button><div className="opts-warning">自动回复可能触发 WhatsApp 的账号限制；扩展无法保证规避平台风控。无法确认聊天对象时不会自动发送。</div></section>
      <section className="opts-section"><h2>分类状态</h2>{(['product', 'payment', 'shipping', 'trust'] as ReplyCategory[]).map((category) => <div className="opts-status-row" key={category}><span>{CATEGORY_NAMES[category]}</span><span className="opts-status-pill" data-on={config.enabled && data.globalAutoReply && data.autoReply[category]}>{!config.enabled ? '插件已暂停' : data.autoReply[category] ? data.globalAutoReply ? '自动回复生效' : '等待全局开启' : '草稿确认'}</span></div>)}<p className="opts-help">分类开关在各自标签管理；商品价格问题和多商品命中始终要求人工确认。</p></section>
    </>}
    <div className="opts-status" data-tone={status.tone}>{status.text}</div>
  </div>;
}

function CategorySwitch({ enabled, onChange }: { enabled: boolean; onChange: (value: boolean) => void }) {
  return <section className="opts-section opts-section-first"><h2>本类别自动回复</h2><div className="opts-toggle"><input type="checkbox" checked={enabled} onChange={(e) => onChange(e.target.checked)} /><span>{enabled ? '已开启（仍需开启全局开关）' : '关闭时只生成草稿'}</span></div></section>;
}

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <div className="opts-row"><label>{label}</label><input type="text" value={value} onChange={(e) => onChange(e.target.value)} /></div>;
}

function ReplyPreview({ language, text, suffix = '' }: { language: ReplyLanguage; text: string; suffix?: string }) {
  const [translated, setTranslated] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const latest = useRef(text);
  latest.current = text;
  useEffect(() => { setTranslated(''); setError(''); }, [text, language]);
  const preview = language === 'es-MX' ? text : translated;
  return <div className="opts-preview"><strong>回复预览</strong>
    {preview ? <p>{[preview, suffix].filter(Boolean).join('\n\n')}</p> : <p>中文内容会翻译成墨西哥西班牙语。预览只在点击时调用 AI。</p>}
    {language === 'zh-CN' && <button type="button" className="opts-secondary" disabled={busy || !text.trim() || Boolean(translated)} onClick={async () => {
      const requestedText = text;
      setBusy(true); setError('');
      try {
        const result = await chrome.runtime.sendMessage({ kind: 'TRANSLATE_PREVIEW', payload: { text, source: 'zh-CN', target: 'es' } });
        if (!result?.ok) throw new Error(result?.error || '翻译预览失败');
        if (latest.current === requestedText) setTranslated(result.translated);
      } catch { setError('预览失败，请检查 AI 服务配置。'); }
      finally { setBusy(false); }
    }}>{busy ? '正在翻译…' : '生成西语预览'}</button>}
    {error && <p className="opts-warning">{error}</p>}
  </div>;
}

function PaymentEditor({ method, onChange, onDelete }: { method: PaymentMethod; onChange: (patch: Partial<PaymentMethod>) => void; onDelete: () => void }) {
  return <div className="opts-payment-card"><div className="opts-payment-head"><input value={method.name} onChange={(e) => onChange({ name: e.target.value })} placeholder="方式名称，例如银行转账" /><label><input type="radio" checked={method.isDefault} onChange={() => onChange({ isDefault: true })} /> 默认</label><label><input type="checkbox" checked={method.enabled} onChange={(e) => onChange({ enabled: e.target.checked })} /> 启用</label><button className="opts-danger-link" onClick={onDelete}>删除</button></div><textarea value={method.content} onChange={(e) => onChange({ content: e.target.value })} placeholder="按上方所选语言填写收款说明；留空时不会参与回复" /></div>;
}

function ProductEditor({ product, onChange, onCancel, onSave, renderKeywords, suggestions, selectedSuggestions, onSuggestionChange, onGenerate, onApplySuggestions, generating }: {
  product: Product; onChange: (product: Product) => void; onCancel: () => void; onSave: (product: Product) => Promise<void>;
  renderKeywords: (category: ReplyCategory, items: ReplyKeyword[]) => React.ReactNode;
  suggestions: string[]; selectedSuggestions: string[]; onSuggestionChange: (values: string[]) => void;
  onGenerate: () => void; onApplySuggestions: () => void;
  generating: boolean;
}) {
  const latestProduct = useRef(product);
  latestProduct.current = product;
  const mounted = useRef(true);
  const [readingImages, setReadingImages] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const update = (patch: Partial<Product>) => onChange({ ...product, ...patch });
  const addImages = async (files: FileList | null) => {
    if (!files || readingImages) return;
    setReadingImages(true);
    try {
      const picked = Array.from(files).slice(0, Math.max(0, 6 - product.images.length));
      const images: ProductImage[] = [];
      for (const file of picked) {
        if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) { window.alert('请选择 JPG、PNG、WebP 或 GIF 图片。'); continue; }
        if (file.size > 1_500_000) { window.alert(`${file.name} 超过 1.5MB，请先压缩图片。`); continue; }
        const dataUrl = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file); });
        images.push({ id: crypto.randomUUID(), name: file.name, dataUrl });
      }
      if (!mounted.current) return;
      const current = latestProduct.current;
      const all = [...current.images, ...images].slice(0, 6);
      onChange({ ...current, images: all, coverImageId: current.coverImageId || all[0]?.id || '' });
    } finally { if (mounted.current) setReadingImages(false); }
  };
  return <div className="opts-editor"><h3>{product.name ? '编辑商品' : '新建商品'}</h3>
    <div className="opts-row"><label>商品名称 *</label><input value={product.name} onChange={(e) => update({ name: e.target.value })} /></div>
    <TextField label="型号" value={product.model} onChange={(model) => update({ model })} />
    <div className="opts-row"><label>商品介绍</label><textarea value={product.description} onChange={(e) => update({ description: e.target.value })} /></div>
    <div className="opts-row"><label>商品图片（最多 6 张，每张不超过 1.5MB）</label><input type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple disabled={readingImages || product.images.length >= 6} onChange={(e) => { void addImages(e.target.files).catch(() => window.alert('读取图片失败，请重新选择。')); e.currentTarget.value = ''; }} /><div className="opts-image-list">{product.images.map((image, index) => <div className="opts-image-item" key={image.id}><img src={image.dataUrl} alt={image.name} /><span>{image.name}</span><label><input type="radio" checked={product.coverImageId === image.id} onChange={() => update({ coverImageId: image.id })} />封面</label><div className="opts-image-order"><button type="button" aria-label="图片前移" disabled={index === 0} onClick={() => { const images = [...product.images]; [images[index - 1], images[index]] = [images[index], images[index - 1]]; update({ images }); }}>←</button><button type="button" aria-label="图片后移" disabled={index === product.images.length - 1} onClick={() => { const images = [...product.images]; [images[index + 1], images[index]] = [images[index], images[index + 1]]; update({ images }); }}>→</button></div><button type="button" onClick={() => { const images = product.images.filter((item) => item.id !== image.id); update({ images, coverImageId: product.coverImageId === image.id ? images[0]?.id ?? '' : product.coverImageId }); }}>删除</button></div>)}</div></div>
    <div className="opts-price"><div className="opts-row"><label>标准售价 *</label><input type="number" min="0" step="any" value={product.price} onChange={(e) => update({ price: e.target.value })} /></div><div className="opts-row"><label>币种</label><select value={product.currency} onChange={(e) => update({ currency: e.target.value })}>{['USD', 'MXN', 'CNY', 'EUR'].map((currency) => <option key={currency}>{currency}</option>)}</select></div></div>
    <div className="opts-row"><label>中文触发关键词</label>{renderKeywords('product', product.keywords)}<button type="button" className="opts-secondary" disabled={generating} onClick={onGenerate}>{generating ? '正在生成…' : '根据商品资料生成建议'}</button><p className="opts-help">会将商品名称、型号和介绍发送给当前配置的 AI 服务；确认并保存商品后关键词才生效。</p></div>
    {suggestions.length > 0 && <div className="opts-suggestions"><strong>确认要启用的建议</strong>{suggestions.map((word) => <label key={word}><input type="checkbox" checked={selectedSuggestions.includes(word)} onChange={(e) => onSuggestionChange(e.target.checked ? [...selectedSuggestions, word] : selectedSuggestions.filter((v) => v !== word))} />{word}</label>)}<button type="button" onClick={onApplySuggestions}>加入已启用关键词</button></div>}
    <div className="opts-toggle"><input type="checkbox" checked={product.enabled} onChange={(e) => update({ enabled: e.target.checked })} /><span>启用此商品</span></div>
    <div className="opts-form-actions"><button className="opts-secondary" onClick={onCancel}>取消</button><button className="opts-primary" disabled={readingImages || saving} onClick={async () => { if (!product.name.trim()) { window.alert('请填写商品名称。'); return; } if (!product.price.trim() || !Number.isFinite(Number(product.price)) || Number(product.price) < 0) { window.alert('请填写有效标准售价。'); return; } setSaving(true); try { await onSave({ ...product, name: product.name.trim(), updatedAt: Date.now() }); } finally { if (mounted.current) setSaving(false); } }}>{readingImages ? '正在读取图片…' : saving ? '正在保存…' : '保存商品'}</button></div>
  </div>;
}
