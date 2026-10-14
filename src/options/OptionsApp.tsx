import { useEffect, useMemo, useRef, useState } from 'react';
import { TranslationSettings } from './TranslationSettings';
import { ClipboardTextField } from './ClipboardTextField';
import { ToggleSwitch } from '@/shared/ui/ToggleSwitch';
import { DEFAULT_PRODUCT_KEYWORDS, newKeyword, type CommonPhrase, type BusinessData, type Config, type PaymentMethod, type Product, type ProductImage, type BuiltinReplyCategory, type ReplyKeyword, type ReplyLanguage } from '@/shared/types';
import { loadBusinessData, loadConfig, saveBusinessData, saveConfig, watchBusinessData, watchConfig } from '@/shared/storage';
import { groupInvitationText, isNumericProductPrice, joinReplyParagraphs, shippingReplyText, validGroupUrl } from '@/shared/business-replies';
import { DEFAULT_PRODUCT_CURRENCY, PRODUCT_CURRENCIES, DEFAULT_WHATSAPP_IMAGE_LIMIT_BYTES, WHATSAPP_IMAGE_LIMIT_KEY, formatImageLimit, loadWhatsAppImageLimit } from '@/shared/product-config';

const TABS = [
  ['settings', '设置'], ['product', '商品'], ['payment', '支付方式'],
  ['shipping', '物流'], ['trust', '信任与保障'], ['phrase', '常用语'],
] as const;
const CATEGORY_NAMES: Record<BuiltinReplyCategory, string> = { product: '商品信息', payment: '支付方式', shipping: '物流与时效', trust: '信任与保障' };

export function OptionsApp() {
  const [config, setConfig] = useState<Config | null>(null);
  const [data, setData] = useState<BusinessData | null>(null);
  const [status, setStatus] = useState<{ tone: 'ok' | 'err' | ''; text: string }>({ tone: '', text: '' });
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Product | null>(null);
  const [adding, setAdding] = useState(false);
  const [editingPhrase, setEditingPhrase] = useState<CommonPhrase | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [selectedSuggestions, setSelectedSuggestions] = useState<string[]>([]);
  const [keywordDraft, setKeywordDraft] = useState('');
  const dataRef = useRef<BusinessData | null>(null);
  const saveQueue = useRef<Promise<unknown>>(Promise.resolve());
  const pendingBusinessWrites = useRef(0);
  const [generatingKeywords, setGeneratingKeywords] = useState(false);
  const [imageLimitBytes, setImageLimitBytes] = useState(DEFAULT_WHATSAPP_IMAGE_LIMIT_BYTES);
  const editingRef = useRef<Product | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => { editingRef.current = editing; }, [editing]);
  useEffect(() => () => { if (flashTimer.current) clearTimeout(flashTimer.current); }, []);

  useEffect(() => {
    Promise.all([loadConfig(), loadBusinessData()]).then(([c, b]) => { setConfig(c); setData(b); dataRef.current = b; })
      .catch(() => setStatus({ tone: 'err', text: '读取配置失败，请重新打开设置。' }));
  }, []);

  useEffect(() => {
    const stopBusiness = watchBusinessData((next) => {
      if (pendingBusinessWrites.current) return;
      dataRef.current = next; setData(next);
    });
    const stopConfig = watchConfig(setConfig);
    return () => { stopBusiness(); stopConfig(); };
  }, []);

  useEffect(() => {
    let disposed = false;
    const refresh = () => { void loadWhatsAppImageLimit().then((limit) => { if (!disposed) setImageLimitBytes(limit); }).catch(() => {}); };
    const onChange = (changes: Record<string, chrome.storage.StorageChange>, area: string) => { if (area === 'local' && changes[WHATSAPP_IMAGE_LIMIT_KEY]) refresh(); };
    refresh();
    chrome.storage.onChanged.addListener(onChange);
    const timer = window.setInterval(refresh, 30_000);
    return () => { disposed = true; clearInterval(timer); chrome.storage.onChanged.removeListener(onChange); };
  }, []);

  const activeTab = data?.activeTab ?? 'settings';
  const setAndSaveConfig = useMemo(() => (patch: Partial<Config>) => {
    const savingPrompt = typeof patch.translationPrompt === 'string';
    // The prompt has an explicit Save action. Mark it saved only after storage
    // succeeds, so a rejected write keeps the draft editable and retryable.
    if (!savingPrompt) setConfig((prev) => prev ? { ...prev, ...patch } : prev);
    return saveConfig(patch).then(() => {
      if (savingPrompt) setConfig((prev) => prev ? { ...prev, ...patch } : prev);
      flash('保存成功'); return true;
    }, () => { flash('保存失败，请重试', true); return false; });
  }, []);

  const updateBusiness = (updater: (prev: BusinessData) => BusinessData) => {
    const previous = dataRef.current;
    if (!previous) return Promise.resolve(false);
    const next = updater(previous);
    dataRef.current = next;
    setData(next);
    pendingBusinessWrites.current++;
    const operation = saveQueue.current.then(() => saveBusinessData(next));
    saveQueue.current = operation.catch(() => {});
    return operation.then(() => { flash('已保存'); return true; }, () => { flash('保存失败，数据未写入，请重试', true); return false; }).finally(() => {
      pendingBusinessWrites.current--;
      if (!pendingBusinessWrites.current) void loadBusinessData().then((stored) => {
        // Reflect the persisted switch after saving, including failed
        // optimistic saves, without replacing a newer local edit.
        if (!pendingBusinessWrites.current && dataRef.current === next) { dataRef.current = stored; setData(stored); }
      }).catch(() => {});
    });
  };
  const flash = (text: string, error = false) => {
    if (flashTimer.current) clearTimeout(flashTimer.current);
    setStatus({ tone: error ? 'err' : 'ok', text });
    if (!error) flashTimer.current = setTimeout(() => setStatus({ tone: '', text: '' }), 1800);
  };

  if (!config || !data) return <div className="opts-shell">正在加载…</div>;

  const setTab = (tab: string) => {
    if (editing && !window.confirm('商品编辑尚未保存，切换标签会丢弃这些修改。继续吗？')) return;
    if (editingPhrase && !window.confirm('常用语编辑尚未保存，切换标签会丢弃这些修改。继续吗？')) return;
    setEditing(null); setEditingPhrase(null); setAdding(false); setSuggestions([]); setKeywordDraft('');
    void updateBusiness((prev) => ({ ...prev, activeTab: tab }));
  };
  const addKeyword = (category: BuiltinReplyCategory, text: string) => {
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
  const updateKeyword = (category: BuiltinReplyCategory, keywordId: string, patch: Partial<ReplyKeyword>) => {
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

  const renderKeywords = (category: BuiltinReplyCategory, items: ReplyKeyword[]) => (
    <div className="opts-keywords">
      <div className="opts-keyword-list">
        {items.filter((keyword) => keyword.text).map((keyword) => <span key={keyword.id} className="opts-keyword" data-enabled={keyword.enabled}>
          <ToggleSwitch compact label={`启用关键词${keyword.text}`} checked={keyword.enabled} onChange={(enabled) => updateKeyword(category, keyword.id, { enabled })} />
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

  const languageSelect = (value: ReplyLanguage, onChange: (value: ReplyLanguage) => void) => <select value={value} onChange={(e) => onChange(e.target.value as ReplyLanguage)}><option value="zh-CN">中文（人工草稿先确认，发送时翻译）</option><option value="es-MX">墨西哥西班牙语（原文发送）</option></select>;
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
  const newProduct = (): Product => ({ id: crypto.randomUUID(), name: '', model: '', description: '', price: '', currency: DEFAULT_PRODUCT_CURRENCY, images: [], coverImageId: '', keywords: DEFAULT_PRODUCT_KEYWORDS.map((text) => newKeyword(text, 'default')), enabled: true, updatedAt: Date.now() });
  const productItems = data.products.filter((p) => `${p.name} ${p.model}`.toLowerCase().includes(search.toLowerCase()));

  return <div className="opts-shell opts-shell-wide">
    <h1>WhatsApp 外贸助手</h1>
    <p className="opts-sub">WhatsApp 外贸回复配置保存在当前浏览器。业务回复目标语言为墨西哥西班牙语。</p>
    <nav className="opts-tabs" aria-label="配置分类">{TABS.map(([id, label]) => <button key={id} type="button" aria-selected={activeTab === id} onClick={() => setTab(id)}>{label}</button>)}</nav>

    {activeTab === 'settings' && <TranslationSettings config={config} onSave={setAndSaveConfig} />}

    {activeTab === 'product' && <section className="opts-section opts-section-first"><div className="opts-heading"><div><h2>商品资料</h2><p className="opts-help">一条商品对应一个具体型号。商品回复目标为墨西哥西班牙语。</p></div><button className="opts-primary" disabled={Boolean(editing)} onClick={() => { setEditing(newProduct()); setAdding(true); setSuggestions([]); setKeywordDraft(''); }}>新建商品</button></div>
      <CategorySwitch category="product" enabled={data.autoReply.product} pluginEnabled={config.enabled} onChange={(enabled) => { void updateBusiness((p) => ({ ...p, autoReply: { ...p.autoReply, product: enabled } })); }} />
      <div className="opts-row"><label>所有商品的内容语言</label>{languageSelect(data.productLanguage, (value) => updateBusiness((p) => ({ ...p, productLanguage: value })))}</div>
      {(adding || editing) ? <ProductEditor key={editing!.id} product={editing!} imageLimitBytes={imageLimitBytes} onChange={setEditing} generating={generatingKeywords} onCancel={() => { setEditing(null); setAdding(false); setSuggestions([]); }} onSave={saveProduct} renderKeywords={renderKeywords} suggestions={suggestions} selectedSuggestions={selectedSuggestions} onSuggestionChange={setSelectedSuggestions} onGenerate={async () => {
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
        <div className="opts-product-list">{productItems.map((product) => <div className="opts-product-row" key={product.id}><div className="opts-product-thumb">{product.images.find((image) => image.id === product.coverImageId) ? <img src={product.images.find((image) => image.id === product.coverImageId)!.dataUrl} /> : <span>无图片</span>}</div><div className="opts-product-main"><strong>{product.name}</strong><span>型号：{product.model || '—'} · {product.price ? isNumericProductPrice(product.price) ? `${product.price} ${product.currency}` : product.price : '未填写价格'}</span><small>{product.keywords.filter((k) => k.enabled).length} 个启用关键词 · {product.enabled ? '已启用' : '已停用'}</small></div><button type="button" onClick={() => { setEditing(product); setAdding(false); setSuggestions([]); setKeywordDraft(''); }}>编辑</button><button type="button" className="opts-danger-link" onClick={() => { if (window.confirm(`确定删除“${product.name}”吗？`)) updateBusiness((p) => ({ ...p, products: p.products.filter((item) => item.id !== product.id) })); }}>删除</button></div>)}{productItems.length === 0 && <div className="opts-empty">{data.products.length ? '没有匹配的商品，请修改搜索条件。' : '还没有商品，点击“新建商品”添加第一条。'}</div>}</div>
      </>}
    </section>}

    {activeTab === 'payment' && <>
      <CategorySwitch category="payment" enabled={data.autoReply.payment} pluginEnabled={config.enabled} onChange={(enabled) => updateBusiness((p) => ({ ...p, autoReply: { ...p.autoReply, payment: enabled } }))} />
      <section className="opts-section"><h2>支付关键词</h2>{renderKeywords('payment', data.paymentKeywords)}</section>
      <section className="opts-section"><div className="opts-heading"><div><h2>收款方式</h2><p className="opts-help">默认方式留空时不会发送；客户表示不方便时展示已填写的备用方式。中文付款草稿先填入中文，你确认发送时才翻译为西语；西语内容原文发送。</p></div><button className="opts-secondary" onClick={() => updateBusiness((p) => ({ ...p, paymentMethods: [...p.paymentMethods, { id: crypto.randomUUID(), name: '', content: '', isDefault: false, enabled: true }] }))}>添加方式</button></div>
        <div className="opts-row"><label>回复内容语言</label>{languageSelect(data.paymentLanguage, (value) => updateBusiness((p) => ({ ...p, paymentLanguage: value })))}</div>
        {data.paymentMethods.map((method) => <PaymentEditor key={method.id} method={method} onChange={(patch) => updateBusiness((p) => ({ ...p, paymentMethods: p.paymentMethods.map((m) => m.id === method.id ? { ...m, ...patch } : { ...m, isDefault: patch.isDefault ? false : m.isDefault }) }))} onDelete={() => updateBusiness((p) => ({ ...p, paymentMethods: p.paymentMethods.filter((m) => m.id !== method.id), ...(method.isDefault ? { paymentMethods: p.paymentMethods.filter((m) => m.id !== method.id).map((m, i) => ({ ...m, isDefault: i === 0 })) } : {}) }))} />)}
      </section>
    </>}

    {activeTab === 'shipping' && <>
      <CategorySwitch category="shipping" enabled={data.autoReply.shipping} pluginEnabled={config.enabled} onChange={(enabled) => updateBusiness((p) => ({ ...p, autoReply: { ...p.autoReply, shipping: enabled } }))} />
      <section className="opts-section"><h2>物流回复关键词</h2>{renderKeywords('shipping', data.shippingKeywords)}</section>
      <section className="opts-section"><h2>物流信息</h2>
        <div className="opts-row"><label>回复内容语言</label>{languageSelect(data.shippingLanguage, (value) => updateBusiness((p) => ({ ...p, shippingLanguage: value })))}</div>
        <TextField label="预计送达时间" value={data.shippingDays} onChange={(v) => updateBusiness((p) => ({ ...p, shippingDays: v }))} />
        <TextField label="物流方式" value={data.shippingMethod} onChange={(v) => updateBusiness((p) => ({ ...p, shippingMethod: v }))} />
        <TextField label="发货安排" value={data.dispatchText} onChange={(v) => updateBusiness((p) => ({ ...p, dispatchText: v }))} />
        <ReplyPreview language={data.shippingLanguage} text={shippingReplyText(data)} />
        <div className="opts-help">回复会说明付款后与财务核实再发货、发货后提供订单号和截图，并提示客户通过订单号查询物流。实际订单号和截图由你在 WhatsApp 中手动发送。</div>
      </section>
    </>}

    {activeTab === 'trust' && <>
      <CategorySwitch category="trust" enabled={data.autoReply.trust} pluginEnabled={config.enabled} onChange={(enabled) => updateBusiness((p) => ({ ...p, autoReply: { ...p.autoReply, trust: enabled } }))} />
      <section className="opts-section"><h2>信任与保障关键词</h2>{renderKeywords('trust', data.trustKeywords)}</section>
      <section className="opts-section"><h2>回复内容</h2><div className="opts-row"><label>回复内容语言</label>{languageSelect(data.trustLanguage, (value) => updateBusiness((p) => ({ ...p, trustLanguage: value })))}</div><div className="opts-row"><label htmlFor="trust-text">付款与发货说明</label><textarea id="trust-text" value={data.trustText} onChange={(e) => updateBusiness((p) => ({ ...p, trustText: e.target.value }))} /></div><div className="opts-row"><label htmlFor="group-url">客户体验群邀请链接（可选）</label><input id="group-url" type="text" value={data.customerGroupUrl} onChange={(e) => updateBusiness((p) => ({ ...p, customerGroupUrl: e.target.value }))} placeholder="https://chat.whatsapp.com/..." /></div><ToggleSwitch id="include-group" label="在回复中附带客户群邀请" checked={data.includeGroupInvite} onChange={(includeGroupInvite) => updateBusiness((p) => ({ ...p, includeGroupInvite }))} /><div className="opts-help">邀请文案会提示群成员可能看到彼此号码和群内发言，链接单独放在最后一行。</div>{data.includeGroupInvite && !validGroupUrl(data.customerGroupUrl) && <p className="opts-warning">请填写有效的 WhatsApp 群邀请链接，否则不会发送这类回复。</p>}<ReplyPreview language={data.trustLanguage} text={data.trustText} suffix={data.includeGroupInvite && validGroupUrl(data.customerGroupUrl) ? groupInvitationText(data.trustLanguage, data.customerGroupUrl) : ''} /></section>
    </>}

    {activeTab === 'phrase' && <section className="opts-section opts-section-first">
      <div className="opts-heading"><div><h2>常用语</h2><p className="opts-help">每条常用语独立启用，命中关键词后自动回复。多条命中时按列表顺序合并发送；禁用项不参与匹配。</p></div><button type="button" className="opts-primary" disabled={Boolean(editingPhrase)} onClick={() => setEditingPhrase({ id: crypto.randomUUID(), title: '', content: '', language: 'zh-CN', enabled: true, keywords: [], updatedAt: Date.now() })}>添加常用语</button></div>
      {editingPhrase ? <PhraseEditor key={editingPhrase.id} phrase={editingPhrase} onChange={setEditingPhrase} onCancel={() => setEditingPhrase(null)} onSave={async (phrase) => {
        const saved = await updateBusiness((prev) => ({ ...prev, phrases: prev.phrases.some((item) => item.id === phrase.id) ? prev.phrases.map((item) => item.id === phrase.id ? phrase : item) : [...prev.phrases, phrase] }));
        if (saved) setEditingPhrase(null);
      }} /> : <div className="opts-phrase-list">
        {data.phrases.map((phrase) => <div className="opts-phrase-row" key={phrase.id}>
          <div className="opts-product-main"><strong>{phrase.title}</strong><span className="opts-phrase-content">{phrase.content}</span><small>{phrase.language === 'zh-CN' ? '中文 → 西语' : '西语原文'} · {phrase.keywords.filter((keyword) => keyword.enabled).length} 个启用关键词</small></div>
          <div className="opts-phrase-actions"><ToggleSwitch compact label={`启用${phrase.title}`} checked={phrase.enabled}
            description={!phrase.enabled ? '命中关键词也不会回复' : !phrase.keywords.some((keyword) => keyword.enabled && keyword.text.trim()) ? '请启用触发关键词' : config.enabled ? '命中关键词后自动发送' : '等待启用翻译插件'}
            onChange={(enabled) => { void updateBusiness((prev) => ({ ...prev, phrases: prev.phrases.map((item) => item.id === phrase.id ? { ...item, enabled, updatedAt: Date.now() } : item) })); }} />
            <button type="button" className="opts-secondary" onClick={() => setEditingPhrase(phrase)}>编辑</button><button type="button" className="opts-danger-link" onClick={() => { if (window.confirm(`确定删除常用语“${phrase.title}”吗？`)) void updateBusiness((prev) => ({ ...prev, phrases: prev.phrases.filter((item) => item.id !== phrase.id) })); }}>删除</button></div>
        </div>)}
        {data.phrases.length === 0 && <div className="opts-empty">还没有常用语，点击“添加常用语”创建第一条。</div>}
      </div>}
    </section>}
    <div className="opts-status" data-tone={status.tone}>{status.text}</div>
  </div>;
}

function AutoReplyToggle({ id, label, enabled, disabled = false, description, onChange }: {
  id: string; label: string; enabled: boolean; disabled?: boolean; description: string; onChange: (value: boolean) => void;
}) {
  return <ToggleSwitch id={id} label={label} checked={enabled} disabled={disabled} description={description} onChange={onChange} />;
}

function CategorySwitch({ category, enabled, pluginEnabled, onChange }: {
  category: BuiltinReplyCategory; enabled: boolean; pluginEnabled: boolean; onChange: (value: boolean) => void;
}) {
  const live = enabled && pluginEnabled;
  const description = !enabled ? '命中关键词后生成草稿，由你手动发送' : live ? '命中关键词后自动填入并发送，无需逐条点击' : '已选择自动发送，等待启用翻译插件';
  return <section className="opts-section opts-section-first"><h2>{CATEGORY_NAMES[category]}自动回复</h2>
    <AutoReplyToggle id={`${category}-auto`} label={`${CATEGORY_NAMES[category]}自动回复`} enabled={enabled} description={description} onChange={onChange} />
    <p id={`${category}-auto-help`} className="opts-help">{live ? '已生效，客户询问后自动发送回复。' : enabled ? '请先在“设置”中启用翻译插件。' : '开启本类别开关即可自动回复。'}</p>
  </section>;
}

function PhraseEditor({ phrase, onChange, onCancel, onSave }: {
  phrase: CommonPhrase; onChange: (phrase: CommonPhrase) => void; onCancel: () => void; onSave: (phrase: CommonPhrase) => Promise<void>;
}) {
  const [keywordText, setKeywordText] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const update = (patch: Partial<CommonPhrase>) => { setError(''); onChange({ ...phrase, ...patch }); };
  const addKeyword = () => {
    const text = keywordText.trim();
    if (!text) return;
    if (phrase.keywords.some((keyword) => keyword.text.trim().toLocaleLowerCase() === text.toLocaleLowerCase())) { setError('已有相同关键词'); return; }
    update({ keywords: [...phrase.keywords, newKeyword(text)] }); setKeywordText('');
  };
  return <div className="opts-editor">
    <h3>{phrase.title ? '编辑常用语' : '新建常用语'}</h3>
    <TextField label="常用语标题 *" value={phrase.title} onChange={(title) => update({ title })} />
    <div className="opts-row"><label>回复内容 *</label><ClipboardTextField multiline label="常用语回复内容" value={phrase.content} onChange={(content) => update({ content })} /></div>
    <div className="opts-row"><label>内容语言</label><select aria-label="常用语内容语言" value={phrase.language} onChange={(event) => update({ language: event.target.value as ReplyLanguage })}><option value="zh-CN">中文（自动翻译为西语）</option><option value="es-MX">墨西哥西班牙语（原文发送）</option></select></div>
    <p className="opts-help">标题仅用于管理，发送时只使用回复内容。关键词可匹配客户原文或中文译文；“你好”也能匹配 Hola、您好、嗨等常见问候。</p>
    <div className="opts-row"><label>触发关键词 *</label><div className="opts-keywords">
      {phrase.keywords.map((keyword) => <div className="opts-phrase-keyword" key={keyword.id}>
        <ToggleSwitch compact label={`启用关键词${keyword.text}`} checked={keyword.enabled} onChange={(enabled) => update({ keywords: phrase.keywords.map((item) => item.id === keyword.id ? { ...item, enabled } : item) })} />
        <input aria-label={`修改关键词${keyword.text}`} value={keyword.text} onChange={(event) => update({ keywords: phrase.keywords.map((item) => item.id === keyword.id ? { ...item, text: event.target.value } : item) })} />
        <button type="button" aria-label={`删除关键词${keyword.text}`} onClick={() => update({ keywords: phrase.keywords.filter((item) => item.id !== keyword.id) })}>删除</button>
      </div>)}
      <div className="opts-keyword-add"><input aria-label="新常用语关键词" value={keywordText} onChange={(event) => setKeywordText(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); addKeyword(); } }} placeholder="输入关键词，按回车添加" /><button type="button" onClick={addKeyword}>添加关键词</button></div>
    </div></div>
    <ToggleSwitch label="启用此常用语" checked={phrase.enabled} description={phrase.enabled ? '命中启用的关键词后自动回复' : '已停用，命中关键词也不会回复'} onChange={(enabled) => update({ enabled })} />
    {error && <p className="opts-warning" role="alert">{error}</p>}
    <div className="opts-form-actions"><button type="button" className="opts-secondary" disabled={saving} onClick={onCancel}>取消</button><button type="button" className="opts-primary" disabled={saving} onClick={async () => {
      if (!phrase.title.trim() || !phrase.content.trim()) { setError('请填写标题和回复内容'); return; }
      const keywords = phrase.keywords.map((keyword) => ({ ...keyword, text: keyword.text.trim() })).filter((keyword) => keyword.text);
      if (!keywords.length) { setError('请至少添加一个触发关键词'); return; }
      if (new Set(keywords.map((keyword) => keyword.text.toLocaleLowerCase())).size !== keywords.length) { setError('请修改重复的触发关键词'); return; }
      setSaving(true);
      try { await onSave({ ...phrase, title: phrase.title.trim(), content: phrase.content.trim(), keywords, updatedAt: Date.now() }); }
      finally { setSaving(false); }
    }}>{saving ? '正在保存…' : '保存常用语'}</button></div>
  </div>;
}

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <div className="opts-row"><label>{label}</label><ClipboardTextField label={label} value={value} onChange={onChange} /></div>;
}

function ReplyPreview({ language, text, suffix = '' }: { language: ReplyLanguage; text: string; suffix?: string }) {
  const [translated, setTranslated] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const sourceText = joinReplyParagraphs([text, suffix], language);
  const signature = JSON.stringify([language, sourceText]);
  const latest = useRef(signature);
  latest.current = signature;
  useEffect(() => { setTranslated(''); setError(''); }, [sourceText, language]);
  return <div className="opts-preview"><strong>{language === 'zh-CN' ? '中文草稿预览' : '西语回复预览'}</strong>
    <p>{sourceText || '请先填写回复内容。'}</p>
    {language === 'zh-CN' && <p>人工回复先以中文放入输入框，确认发送后才翻译。下方按钮可按需查看西语译文，不会发送消息。</p>}
    {translated && <><strong>西语译文参考</strong><p>{translated}</p></>}
    {language === 'zh-CN' && <button type="button" className="opts-secondary" disabled={busy || !sourceText.trim() || Boolean(translated)} onClick={async () => {
      const requestedSignature = signature;
      setBusy(true); setError('');
      try {
        const result = await chrome.runtime.sendMessage({ kind: 'TRANSLATE_PREVIEW', payload: { text: sourceText, source: 'zh-CN', target: 'es' } });
        if (!result?.ok) throw new Error(result?.error || '翻译预览失败');
        if (latest.current === requestedSignature) setTranslated(result.translated);
      } catch { setError('预览失败，请检查 AI 服务配置。'); }
      finally { setBusy(false); }
    }}>{busy ? '正在翻译…' : '生成西语预览'}</button>}
    {error && <p className="opts-warning">{error}</p>}
  </div>;
}

function PaymentEditor({ method, onChange, onDelete }: { method: PaymentMethod; onChange: (patch: Partial<PaymentMethod>) => void; onDelete: () => void }) {
  return <div className="opts-payment-card"><div className="opts-payment-head"><input value={method.name} onChange={(e) => onChange({ name: e.target.value })} placeholder="方式名称，例如银行转账" /><label><input type="radio" checked={method.isDefault} onChange={() => onChange({ isDefault: true })} /> 默认</label><ToggleSwitch compact label={`启用${method.name || '支付方式'}`} checked={method.enabled} onChange={(enabled) => onChange({ enabled })} /><button className="opts-danger-link" onClick={onDelete}>删除</button></div><ClipboardTextField multiline label={`${method.name || '支付方式'}收款说明`} value={method.content} onChange={(content) => onChange({ content })} placeholder="按上方所选语言填写收款说明；留空时不会参与回复" /></div>;
}

function ProductEditor({ product, imageLimitBytes, onChange, onCancel, onSave, renderKeywords, suggestions, selectedSuggestions, onSuggestionChange, onGenerate, onApplySuggestions, generating }: {
  product: Product; onChange: (product: Product) => void; onCancel: () => void; onSave: (product: Product) => Promise<void>;
  imageLimitBytes: number;
  renderKeywords: (category: BuiltinReplyCategory, items: ReplyKeyword[]) => React.ReactNode;
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
        if (file.size > imageLimitBytes) { window.alert(`${file.name} 超过 WhatsApp 图片大小限制（${formatImageLimit(imageLimitBytes)}），请压缩后重新选择。`); continue; }
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
    <div className="opts-row"><label>商品描述</label><ClipboardTextField multiline label="商品描述" value={product.description} onChange={(description) => update({ description })} /></div>
    <div className="opts-row"><label>商品图片（最多 6 张，每张不超过 {formatImageLimit(imageLimitBytes)}）</label><input type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple disabled={readingImages || product.images.length >= 6} onChange={(e) => { void addImages(e.target.files).catch(() => window.alert('读取图片失败，请重新选择。')); e.currentTarget.value = ''; }} /><div className="opts-image-list">{product.images.map((image, index) => <div className="opts-image-item" key={image.id}><img src={image.dataUrl} alt={image.name} /><span>{image.name}</span><label><input type="radio" checked={product.coverImageId === image.id} onChange={() => update({ coverImageId: image.id })} />封面</label><div className="opts-image-order"><button type="button" aria-label="图片前移" disabled={index === 0} onClick={() => { const images = [...product.images]; [images[index - 1], images[index]] = [images[index], images[index - 1]]; update({ images }); }}>←</button><button type="button" aria-label="图片后移" disabled={index === product.images.length - 1} onClick={() => { const images = [...product.images]; [images[index + 1], images[index]] = [images[index], images[index + 1]]; update({ images }); }}>→</button></div><button type="button" onClick={() => { const images = product.images.filter((item) => item.id !== image.id); update({ images, coverImageId: product.coverImageId === image.id ? images[0]?.id ?? '' : product.coverImageId }); }}>删除</button></div>)}</div></div>
    <div className="opts-price"><div className="opts-row"><label>价格或报价说明 *</label><ClipboardTextField multiline label="价格或报价说明" value={product.price} onChange={(price) => update({ price })} placeholder="填写数字价格，或英文／西语报价，例如 Model A: 250 MXN" /></div><div className="opts-row"><label>币种</label><select value={product.currency} onChange={(e) => update({ currency: e.target.value })}>{PRODUCT_CURRENCIES.map((currency) => <option key={currency.code} value={currency.code}>{currency.code}（{currency.name}）</option>)}</select></div></div>
    <p className="opts-help">纯数字价格附所选币种；英文／西语报价说明保留原文和换行，不额外添加币种。开启商品自动发送后，询价也会自动回复。</p>
    <div className="opts-row"><label>中文触发关键词</label>{renderKeywords('product', product.keywords)}<button type="button" className="opts-secondary" disabled={generating} onClick={onGenerate}>{generating ? '正在生成…' : '根据商品资料生成建议'}</button><p className="opts-help">会将商品名称、型号和介绍发送给当前配置的 AI 服务；确认并保存商品后关键词才生效。</p></div>
    {suggestions.length > 0 && <div className="opts-suggestions"><strong>确认要启用的建议</strong>{suggestions.map((word) => <label key={word}><input type="checkbox" checked={selectedSuggestions.includes(word)} onChange={(e) => onSuggestionChange(e.target.checked ? [...selectedSuggestions, word] : selectedSuggestions.filter((v) => v !== word))} />{word}</label>)}<button type="button" onClick={onApplySuggestions}>加入已启用关键词</button></div>}
    <ToggleSwitch label="启用此商品" checked={product.enabled} onChange={(enabled) => update({ enabled })} />
    <div className="opts-form-actions"><button className="opts-secondary" onClick={onCancel}>取消</button><button className="opts-primary" disabled={readingImages || saving} onClick={async () => { if (!product.name.trim()) { window.alert('请填写商品名称。'); return; } if (!product.price.trim()) { window.alert('请填写价格或报价说明。'); return; } setSaving(true); try { await onSave({ ...product, name: product.name.trim(), updatedAt: Date.now() }); } finally { if (mounted.current) setSaving(false); } }}>{readingImages ? '正在读取图片…' : saving ? '正在保存…' : '保存商品'}</button></div>
  </div>;
}
