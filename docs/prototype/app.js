(function () {
    'use strict';
    const H = window.Haomai, e = H.esc, b = H.button, ib = H.iconButton;
    const state = H.makeState('chrome');
    state.accountFilter = 'mx'; state.selectedCategory = 'quotation'; state.sideTab = 'quick';
    const screens = [
        ['chat', 'WhatsApp 聊天', 'chat', '01', '在熟悉的聊天里，看懂原文，轻松回复。'],
        ['popup', '扩展弹窗 · 已绑定', 'link', '02', '好麦账号、扩展连接与 WhatsApp 状态，一眼可见。'],
        ['bind', '连接与二维码', 'scan', '03', '直接登录或注册，也可使用好麦 App 扫码连接。'],
        ['categories', '类别', 'folder', '04', '维护属于自己的文字、图片、关键词与自动回复。'],
        ['language', '翻译与外观', 'translate', '05', '语言与显示偏好，按使用习惯设置。'],
        ['feedback', '意见反馈', 'feedback', '06', '提交问题，查看来自好麦团队的回复。'],
        ['plans', '套餐与用量', 'crown', '07', '按字符额度选择适合自己的套餐。'],
        ['login', '登录', 'shield', '08', '直接登录好麦，当前扩展自动关联你的账号。'],
        ['register', '注册账号', 'plus', '09', '无需手机 App，也能在 Chrome 开始使用好麦。'],
        ['forgot-password', '忘记密码', 'shield', '10', '验证手机号后，设置新的登录密码。']
    ];
    screens.unshift(['app-guide', '手机 App 引导', 'phone', '00', '在手机上，统一查看和回复客户。']);
    const order = ['login', 'register', 'forgot-password', 'popup', 'bind', 'app-guide', 'chat', 'categories', 'language', 'feedback', 'plans'];
    screens.sort(function (a, c) { return order.indexOf(a[0]) - order.indexOf(c[0]); });
    screens.forEach(function (entry, index) { entry[3] = String(index + 1).padStart(2, '0'); });
    const theme = H.createTheme(state, function () { render(); });
    state.screen = 'popup';
    state.popupDismissed = false;
    const initial = location.hash.slice(1);
    if (screens.some(function (s) { return s[0] === initial; })) state.screen = initial;
    if (initial === 'bind') state.bound = false;
    if (new URLSearchParams(location.search).get('theme') === 'dark') state.theme = 'dark';
    document.getElementById('brand').innerHTML = H.mark();
    document.getElementById('toolbar-mark').innerHTML = H.mark();
    function go(screen) {
        if (screen === 'popup' && !state.authenticated) screen = 'bind';
        state.screen = screen; state.layers = []; state.popupDismissed = false;
        if (!state.authenticated && !['login', 'register', 'forgot-password', 'bind', 'app-guide'].includes(screen)) { screen = 'login'; state.screen = screen; }
        try {
            history.pushState({}, '', '#' + screen);
        } catch (error) {
            // Some file viewers reject History API writes; in-page navigation still works.
            if (location.protocol !== 'file:') throw error;
        }
        render();
    }
    function boundPopup() {
        if (state.popupDismissed) return '<div class="popup-stage popup-closed"><p>点击浏览器工具栏的好麦图标</p></div>';
        const a = state.accounts[0], status = H.sourceStatus(state, a);
        return '<div class="popup-stage" data-popup-backdrop><div class="popup-context"><div></div><div></div></div><section class="popup-window compact-popup" aria-label="好麦扩展弹窗"><header class="popup-header"><div class="brand">' + H.mark() + '<span class="brand-name">好麦</span></div>' + ib('settings', '打开设置', 'navigate', 'language') + '</header><div class="popup-content"><div class="popup-profile">' + H.avatar(state.user.name, 'green') + '<div><h3>' + e(state.user.name) + '</h3><p>' + e(state.user.phone) + '</p></div></div><div class="popup-source"><span class="feature-icon tone-green">' + H.icon('account') + '</span><div><strong>' + e(a ? a.name : 'WhatsApp') + '</strong><small>' + e(a ? a.number : '尚未关联') + '</small></div>' + H.sourceBadge(state, a) + '</div>' + (!status.ready ? '<div class="warning-note">' + H.icon('warning') + '<span>' + H.sourceProblem(state, a) + '</span></div>' : '') + b(H.icon('chat') + ' 打开 WhatsApp', 'navigate', 'chat', 'button primary block') + '<div class="popup-quick">' + b(H.icon('folder') + ' 常用内容', 'navigate', 'categories', 'button') + b(H.icon('phone') + ' 手机收发', 'navigate', 'app-guide', 'button') + '</div><div class="popup-usage"><span>' + (state.hasSubscription ? '剩余 67.8 万字符' : '尚未订购套餐') + '</span>' + b('详情 ' + H.icon('arrow'), 'navigate', 'plans', 'text-button') + '</div></div><footer class="popup-footer">' + b(H.icon('scan') + ' 连接手机', 'show-bind-qr', null, 'text-button') + b('退出登录', 'sign-out', null, 'text-button danger') + '</footer></section></div>';
    }
    function bindPopup() {
        if (state.popupDismissed) return '<div class="popup-stage popup-closed"><p>点击浏览器工具栏的好麦图标</p></div>';
        return '<div class="popup-stage"><div class="popup-context"><div></div><div></div></div><section class="popup-window"><header class="popup-header"><div class="brand">' + H.mark() + '<span class="brand-name">好麦</span></div><span class="pill">' + (state.authenticated ? '已关联账号' : '开始使用') + '</span></header><div class="popup-content"><div class="bind-heading"><h2>' + (state.authenticated ? '在手机上继续' : '连接你的生意') + '</h2><p>' + (state.authenticated ? e(state.user.name) + ' · ' + e(state.user.phone) : '直接登录，当前扩展自动关联账号') + '</p></div>' +
            (!state.authenticated ? '<div class="bind-auth-actions">' + b('登录好麦', 'navigate', 'login', 'button primary') + b('注册账号', 'navigate', 'register', 'button') + '</div><div class="bind-divider"><span>也可用好麦 App 扫码</span></div>' : '') +
            '<div class="qr-wrap">' + H.qr() + '</div><p class="qr-caption">' + (state.authenticated ? '使用同一好麦账号扫码连接' : '好麦 App → 右上角扫一扫') + '</p>' + b(H.icon('scan') + ' 刷新二维码', 'refresh-qr', null, 'text-button popup-refresh') +
            '<div class="bind-status"><span>当前 WhatsApp</span><span class="status ' + (state.whatsappLoggedIn ? '' : 'warning') + '"><i></i>' + (state.whatsappLoggedIn ? '已登录 · 墨西哥业务' : '尚未登录') + '</span></div>' + (state.authenticated ? b('返回扩展', 'navigate', 'popup', 'button primary block spaced') : b('已在 App 中完成绑定', 'complete-binding', null, 'button block spaced')) + '</div><footer class="popup-footer"><span>当前扩展 · 办公电脑</span><span>好麦，聊出好生意</span></footer></section></div>';
    }
    function authPage(mode) {
        return '<div class="full-auth-stage"><header class="full-auth-brand"><div class="brand">' + H.mark() + '<span class="brand-name">好麦</span></div>' + b(H.icon('scan') + ' 扫码连接', 'navigate', 'bind', 'text-button') + '</header><div class="full-auth-layout"><div class="auth-intro"><p class="eyebrow">GOOD CONVERSATIONS</p><h1>聊懂每一句，<br>接住每一份生意。</h1><p>在熟悉的 WhatsApp 中跨语言沟通，<br>也能在手机上统一查看客户消息。</p></div><section class="auth-window full-auth-card">' + (mode !== 'login' ? ib('back', '返回登录', 'navigate', 'login') : '') + auth.form(mode) + '<p class="auth-extension-note">' + (mode === 'forgot-password' ? '重置后返回登录' : '登录后自动关联当前扩展') + '</p></section></div></div>';
    }
    function appGuide() {
        return '<div class="full-auth-stage"><header class="full-auth-brand"><div class="brand">' + H.mark() + '<span class="brand-name">好麦</span></div>' + b('返回扩展 ' + H.icon('arrow'), 'navigate', state.authenticated ? 'popup' : 'bind', 'text-button') + '</header><div class="app-guide-layout"><div class="guide-phone"><div class="guide-phone-head">好麦 ' + H.icon('chat') + '</div><div class="guide-mock-row"><span class="avatar tone-green">M</span><div><strong>墨西哥业务</strong><p>您好，我想了解产品报价。</p></div></div><div class="guide-mock-row"><span class="avatar tone-blue">A</span><div><strong>北美业务</strong><p>已经收到您发来的图片。</p></div></div><div class="guide-phone-bubble">好的，我来为您准备。' + H.icon('checks') + '</div></div><section><p class="eyebrow">HAOMAI ON MOBILE</p><h1>离开电脑，<br>客户消息也在身边。</h1><p>下载好麦 App，登录同一账号，<br>在手机上统一收发多个账号的消息。</p><div class="guide-actions">' + b(H.icon('download') + ' 下载 App', 'public-link', 'appDownload', 'button primary') + b(H.icon('external') + ' 访问官网', 'public-link', 'website', 'button') + '</div>' + b(H.icon('scan') + ' 已有 App？扫码连接', 'navigate', 'bind', 'text-button') + '</section></div></div>';
    }
    function replyPanel() {
        const c = H.contact(state);
        const content = state.sideTab === 'customer' ? '<div class="reply-customer"><div class="profile-hero">' + H.avatar(c.name, c.tone, 'large') + '<h2>' + e(c.name) + '</h2><p>' + c.country + ' · ' + c.number + '</p></div><div class="info-row"><span>客户母语</span><strong>' + c.language + '</strong></div><div class="info-row"><span>客户标签</span><strong>' + (c.tag || '未设置') + '</strong></div><div class="info-row"><span>来源账号</span><strong>墨西哥业务</strong></div></div>' :
            '<div class="chips">' + state.categories.slice().sort(function (a, c) { return a.sort - c.sort; }).map(function (c) { return b(e(c.name), 'side-category', c.id, 'chip ' + (state.selectedCategory === c.id ? 'active' : '')); }).join('') + '</div><div class="section-heading"><h3>我的内容</h3>' + b(H.icon('plus'), 'add-item', null, 'icon-button', ' aria-label="添加内容"') + '</div>' + H.itemCards(state, true) + '<p class="help">内容先填入输入框，确认后发送。<br>自动回复仅使用启用的中文关键词。</p>';
        return '<aside class="reply-panel"><header class="reply-panel-head"><div class="brand">' + H.mark() + '<span class="brand-name">好麦</span></div><span class="status"><i></i>已绑定</span></header><div class="reply-account"><p>当前来源账号</p><strong>墨西哥业务 · +52 5500000001</strong></div><nav class="reply-panel-tabs">' +
            b('类别', 'side-tab', 'quick', state.sideTab === 'quick' ? 'active' : '') + b('客户资料', 'side-tab', 'customer', state.sideTab === 'customer' ? 'active' : '') + '</nav><div class="reply-panel-body">' + content + '</div><footer class="reply-panel-footer"><span>' + e(state.user.name) + ' · ' + (state.extensionConnected ? '配置已同步' : '等待连接') + '</span>' + b(H.icon('settings') + ' 管理类别', 'navigate', 'categories', 'text-button') + '</footer></aside>';
    }
    function whatsapp() {
        const c = H.contact(state), a = H.account(state, c.account), status = H.sourceStatus(state, a);
        return '<div class="wa-shell"><aside class="wa-rail">' + ib('chat', '聊天', 'navigate', 'chat', 'active') + ib('account', '客户资料', 'customer') + '<span class="rail-spacer"></span>' + ib('settings', '好麦设置', 'navigate', 'language') + H.avatar(state.user.name, 'green') + '</aside><section class="wa-list"><header class="wa-list-head"><h2>聊天</h2>' + ib('more', '扩展状态', 'navigate', 'popup') + '</header>' + H.searchBox('搜索或开始新对话', 'messages', state.messageQuery) + '<div class="contacts-list">' + H.contactRows(state) + '</div><footer class="wa-account"><strong>墨西哥业务</strong>' + H.sourceBadge(state, a) + '</footer></section>' +
            '<section class="wa-chat"><header class="wa-chat-head">' + H.avatar(c.name, c.tone) + '<div class="wa-chat-person"><h2>' + e(c.name) + '</h2><small>' + c.country + ' · ' + c.language + '</small></div>' + ib('account', '查看客户', 'customer') + '</header>' +
            (!status.ready ? '<div class="warning-note">' + H.icon('warning') + (!state.bound ? '请先登录好麦或扫码绑定' : !status.connected ? 'Chrome 已离线，无法发送消息' : 'WhatsApp 尚未登录，无法发送消息') + '</div>' : '') +
            '<div class="language-strip">' + H.icon('translate') + '我的母语：' + state.language + ' &nbsp;·&nbsp; 客户母语：' + c.language + '</div><div class="message-thread"><div class="day-marker">今天</div><div class="bubble">Hola, ¿podrían mejorar el precio para un pedido de 500 unidades?<div class="translation">您好，订购 500 件可以给我们更优惠的价格吗？</div><div class="message-meta">09:32</div></div>' +
            '<div class="bubble sent">¡Hola! Claro, podemos preparar una cotización para ti.<div class="translation">您好，当然可以，我来为您准备报价。</div><div class="message-meta">来自 App · 09:34 ' + H.icon('checks') + '</div></div><div class="bubble">También queremos personalizar el embalaje.<div class="translation">另外，我们想定制产品包装。</div><div class="message-meta">09:38</div></div>' +
            (state.sent[c.id] || []).map(function (m) { return '<div class="bubble sent">' + (m.image ? '<button class="image-preview" data-action="feedback-image" data-src="' + e(m.image) + '"><img src="' + e(m.image) + '" alt="待发送的内容"></button>' : '') + (m.translated ? e(m.translated) + '<div class="translation">' + e(m.text) + '</div>' : e(m.text)) + '<div class="message-meta">' + (m.pending ? '待翻译' : 'Chrome · 刚刚 ' + H.icon('checks')) + '</div></div>'; }).join('') + '</div>' +
            (state.draftImage ? '<div class="warning-note">' + H.icon('image') + ' 已附加图片 ' + b('移除', 'clear-attachment', null, 'text-button') + '</div>' : '') +
            '<div class="chat-composer">' + ib('folder', '选择常用内容', 'quick') + '<textarea id="draft" rows="1" aria-label="消息内容" placeholder="' + (status.ready ? '用中文输入，发给客户的是对方母语' : '请先恢复连接') + '"' + (status.ready ? '' : ' disabled') + '>' + e(state.draftText || '') + '</textarea><button class="send-button" aria-label="发送消息" data-action="send"' + (status.ready ? '' : ' disabled') + '>' + H.icon('send') + '</button></div></section>' + replyPanel() + '</div>';
    }
    const settingsPages = [['categories', '类别', 'folder'], ['language', '翻译与外观', 'translate'], ['plans', '套餐与用量', 'crown'], ['feedback', '意见反馈', 'feedback']];
    function settingsShell(title, description, content, action) {
        return '<div class="settings-shell"><aside class="settings-sidebar"><div class="brand">' + H.mark() + '<span class="brand-name">好麦</span></div><h3>我的工作空间</h3>' + settingsPages.map(function (s) { return b(H.icon(s[2]) + s[1], 'navigate', s[0], 'settings-nav ' + (s[0] === state.screen ? 'active' : '')); }).join('') + b(H.icon('chat') + ' 返回 WhatsApp', 'navigate', 'chat', 'settings-nav') + '<div class="sidebar-user">' + H.avatar(state.user.name, 'green') + '<div>' + e(state.user.name) + '<small>' + e(state.user.company || state.user.phone) + '</small></div></div></aside><section class="settings-main"><header class="settings-heading"><div><h1>' + title + '</h1><p>' + description + '</p></div>' + (action || '') + '</header>' + content + '</section></div>';
    }
    function categories() {
        return settingsShell('类别', '常用文字与图片，准备好就能用。', '<div class="settings-panel"><div class="category-list" role="list" aria-label="我的类别">' + H.categoryRows(state) + '</div></div>', b(H.icon('plus'), 'add-category', null, 'icon-button', ' aria-label="添加类别"'));
    }
    function language() {
        return settingsShell('翻译与外观', '让沟通和阅读，更符合你的习惯。', '<div class="language-grid"><div class="settings-panel"><h2>语言设置</h2><div class="setting-row"><div><strong>我的母语</strong><small>阅读译文与撰写回复时使用</small></div>' + b(state.language + ' ' + H.icon('arrow'), 'select-language', null, 'button small') + '</div><div class="note">' + H.icon('translate') + '<span>客户母语按会话区分。发给客户的文字使用客户母语。</span></div></div><div class="settings-panel"><h2>显示偏好</h2><div class="setting-row"><div><strong>自动展示来信译文</strong><small>当前扩展的消息显示偏好</small></div><label class="switch"><input type="checkbox" data-setting="translate"' + (state.autoTranslate ? ' checked' : '') + ' aria-label="自动展示来信译文"><span></span></label></div><div class="setting-row"><div><strong>深色模式</strong><small>仅调整当前界面外观</small></div>' + b((state.themeMode === 'system' ? '跟随系统' : state.themeMode === 'dark' ? '深色模式' : '浅色模式') + ' ' + H.icon('arrow'), 'theme-picker', null, 'button small') + '</div></div></div><div class="settings-panel spaced"><h2 style="font-size:16px">连接状态</h2><div class="info-row"><span>当前浏览器扩展</span><strong>Chrome · 办公电脑</strong></div><div class="info-row"><span>关联 WhatsApp</span><strong>墨西哥业务 · +52 5500000001</strong></div><div class="info-row"><span>当前状态</span>' + H.sourceBadge(state, state.accounts[0]) + '</div></div>');
    }
    function feedback() {
        return settingsShell('意见反馈', '关于沟通体验，你的建议对我们很重要。', '<div class="settings-panel">' + H.feedbackList(state) + '</div>', b(H.icon('plus') + ' 提交意见反馈', 'feedback', null, 'button primary'));
    }
    function plans() {
        const options = state.plans.filter(function (p) { return p.type === state.planType; });
        const selected = options.find(function (p) { return p.id === state.selectedPlan; }) || options[0];
        state.selectedPlan = selected.id;
        return settingsShell('套餐与用量', '按字符额度选择，让每笔用量都清楚。', '<div class="settings-panel"><div class="section-heading" style="margin-top:0"><h3>' + (state.hasSubscription ? '基础月套餐' : '尚未订购套餐') + '</h3><span class="pill green">' + (state.hasSubscription ? '使用中' : '未订购') + '</span></div><div class="info-row"><span>本月剩余 / 总额度</span><strong style="font-size:23px">' + (state.hasSubscription ? '678,240 <small>/ 1,000,000 字符</small>' : '0 字符') + '</strong></div></div>' + H.plans(state) + '<div class="desktop-checkout"><strong>¥' + selected.price + '<small>' + selected.unit + '</small></strong>' + b('确认选择', 'order', selected.id, 'button primary') + '</div>');
    }
    const auth = H.createAuth(state, go);
    if (initial === 'bind') { state.authenticated = false; state.bound = false; }
    const renderers = { 'app-guide': appGuide, chat: whatsapp, popup: boundPopup, bind: bindPopup, categories: categories, language: language, feedback: feedback, plans: plans, login: function () { return authPage('login'); }, register: function () { return authPage('register'); }, 'forgot-password': function () { return authPage('forgot-password'); } };
    function render() {
        if (!state.authenticated && !['login', 'register', 'forgot-password', 'bind', 'app-guide'].includes(state.screen)) { state.screen = 'login'; state.layers = []; }
        const screen = screens.find(function (s) { return s[0] === state.screen; }) || screens[0];
        document.body.dataset.theme = state.theme;
        document.getElementById('screen-name').textContent = screen[1];
        document.getElementById('screen-caption').textContent = screen[4];
        document.getElementById('theme-toggle').innerHTML = H.icon(state.theme === 'dark' ? 'sun' : 'theme') + ' ' + (state.theme === 'dark' ? '浅色模式' : '深色模式');
        document.getElementById('review-nav').innerHTML = screens.map(function (s) { return b(H.icon(s[2]) + '<span>' + s[1] + '</span><em>' + s[3] + '</em>', 'navigate', s[0], 'review-nav-item ' + (s[0] === state.screen ? 'active' : '')); }).join('');
        const popupMode = ['popup', 'bind'].includes(state.screen);
        document.getElementById('browser').classList.toggle('popup-mode', popupMode);
        document.getElementById('tab-title').textContent = state.screen === 'chat' || popupMode ? 'WhatsApp' : '好麦 · 我的工作空间';
        document.getElementById('address').textContent = state.screen === 'chat' || popupMode ? 'web.whatsapp.com' : '好麦 / 扩展设置';
        document.getElementById('browser').classList.toggle('full-page-mode', !popupMode);
        document.getElementById('chrome').innerHTML = (renderers[state.screen] || whatsapp)();
        document.getElementById('layers').innerHTML = H.layers(state);
        const thread = document.querySelector('.message-thread');
        if (thread) thread.scrollTop = thread.scrollHeight;
        if (!state.autoTranslate && state.screen === 'chat') document.querySelectorAll('.bubble:not(.sent) .translation').forEach(function (n) { n.hidden = true; });
    }
    const api = H.wire(state, render, go, function (action, id, node, ui) {
        if (action === 'navigate') {
            if (!state.authenticated && node.closest('#review-nav') && !['login', 'register', 'forgot-password', 'bind', 'app-guide'].includes(id)) { auth.preview(id); return true; }
            go(id); return true;
        }
        if (action === 'public-link') {
            const url = H.publicLinks[id];
            if (url) window.open(url, '_blank', 'noopener,noreferrer');
            else ui.toast(id === 'appDownload' ? 'App 下载地址将在正式发布前配置' : '官网地址将在正式发布前配置');
            return true;
        }
        if (action === 'theme-picker') { ui.open('theme-picker'); return true; }
        if (action === 'choose-theme') { state.layers = []; theme.set(id); return true; }
        if (action === 'theme') { theme.set(state.theme === 'dark' ? 'light' : 'dark'); return true; }
        if (action === 'contact') { state.selectedContact = id; H.contact(state).unread = 0; state.draftText = ''; state.draftImage = ''; render(); return true; }
        if (action === 'select-plan') { state.selectedPlan = id; render(); return true; }
        if (action === 'side-category') { state.selectedCategory = id; render(); return true; }
        if (action === 'side-tab') { state.sideTab = id; render(); return true; }
        if (action === 'refresh-qr') { ui.toast('绑定码已刷新'); return true; }
        if (action === 'complete-binding') { auth.fromScan(); return true; }
        if (action === 'show-bind-qr') { go('bind'); return true; }
        if (action === 'use-item') {
            const item = state.items.find(function (i) { return i.id === id; });
            state.draftText = item.text; state.draftImage = item.image; state.layers = []; render();
            const draft = document.getElementById('draft');
            if (draft) draft.focus(); return true;
        }
        if (action === 'clear-attachment') { state.draftImage = ''; render(); return true; }
        if (action === 'send') {
            const c = H.contact(state);
            if (!H.sourceStatus(state, H.account(state, c.account)).ready) { ui.toast('请先恢复对应 Chrome 和 WhatsApp 连接'); return true; }
            const text = document.getElementById('draft').value.trim();
            if (!text && !state.draftImage) { ui.toast('请输入消息或添加图片'); return true; }
            const translations = {
                '请问您需要多少件？我可以按数量为您报价。': '¿Cuántas unidades necesita? Puedo preparar una cotización según la cantidad.',
                '已收到您的需求，我会尽快确认后回复您。': 'Hemos recibido su solicitud. La confirmaré y le responderé lo antes posible.',
                '产品使用独立纸箱包装，可按订单要求确认包装方式。': 'Los productos se embalan en cajas individuales. Podemos confirmar el embalaje según los requisitos del pedido.'
            };
            if (!state.sent[c.id]) state.sent[c.id] = [];
            state.sent[c.id].push({ text: text, image: state.draftImage, translated: translations[text], pending: !!text && !translations[text] });
            state.draftText = ''; state.draftImage = ''; render(); return true;
        }
        return false;
    });
    document.getElementById('connection-state').addEventListener('change', function (event) {
        state.extensionConnected = event.target.value !== 'offline';
        state.whatsappLoggedIn = event.target.value !== 'wa';
        render();
    });
    document.addEventListener('change', function (event) {
        if (event.target.dataset.setting === 'theme') theme.set(event.target.value);
        if (event.target.dataset.setting === 'translate') { state.autoTranslate = event.target.checked; api.toast('显示偏好已保存'); }
    });
    document.addEventListener('input', function (event) {
        if (event.target.id === 'draft') state.draftText = event.target.value;
    });
    document.addEventListener('click', function (event) {
        if (!['popup', 'bind'].includes(state.screen) || state.layers.length) return;
        if (event.target.closest('.popup-window, .browser-extension, #review-nav, .preview-tools')) return;
        if (event.target.closest('.popup-stage')) { state.popupDismissed = true; render(); }
    });
    document.addEventListener('keydown', function (event) { if (event.key === 'Escape' && ['popup', 'bind'].includes(state.screen) && !state.layers.length) { state.popupDismissed = true; render(); } });
    window.addEventListener('popstate', function () { state.screen = location.hash.slice(1) || 'chat'; state.layers = []; render(); });
    render();
})();
