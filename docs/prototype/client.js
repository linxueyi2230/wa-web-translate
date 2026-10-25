(function () {
    'use strict';
    const paths = {
        chat: '<path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z"/><path d="M8 10h8M8 14h5"/>',
        account: '<rect x="3" y="4" width="18" height="17" rx="3"/><circle cx="12" cy="10" r="3"/><path d="M7 18c1-4 9-4 10 0"/>',
        scan: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m8 0h5v-5M3 12h18"/><rect x="7" y="7" width="3" height="3"/><rect x="14" y="14" width="3" height="3"/>',
        settings: '<path d="m10 3-.6 2.2-2 .9-2.1-.6L3.5 8.7 5 10.4v2.3l-1.5 1.7 1.8 3.1 2.2-.5 2 .9.5 2.1h3.6l.6-2.1 2-.9 2.1.5 1.8-3.1-1.5-1.7v-2.3l1.5-1.7-1.8-3.2-2.1.6-2-.9L13.6 3Z"/><circle cx="11.8" cy="11.5" r="3"/>',
        search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
        plus: '<path d="M12 5v14M5 12h14"/>',
        back: '<path d="m14 5-7 7 7 7"/>',
        arrow: '<path d="m9 5 7 7-7 7"/>',
        close: '<path d="m6 6 12 12M6 18 18 6"/>',
        more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
        grip: '<circle cx="9" cy="5" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="19" r="1"/>',
        theme: '<path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z"/>',
        sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
        image: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 5-5 4 4 4-6 5 7"/>',
        mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8"/>',
        send: '<path d="m21 3-7 18-3-8-8-3Z"/><path d="m11 13 10-10"/>',
        check: '<path d="m5 12 4 4L19 6"/>',
        checks: '<path d="m2 12 4 4L16 6m-6 10L20 6"/>',
        folder: '<path d="M3 7a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v9H3Z"/>',
        translate: '<path d="M3 5h12M9 3v2M6 5c0 6 5 10 9 11M13 5c-1 6-5 9-10 11m11 5 4-10 4 10m-7-3h6"/>',
        laptop: '<rect x="4" y="3" width="16" height="13" rx="2"/><path d="m4 16-2 5h20l-2-5"/>',
        phone: '<rect x="6" y="2" width="12" height="20" rx="3"/><path d="M10 18h4"/>',
        feedback: '<path d="M21 11a8 8 0 0 1-8 8H8l-5 3V7a4 4 0 0 1 4-4h6a8 8 0 0 1 8 8Z"/><path d="M12 7v5m0 3h.01"/>',
        crown: '<path d="m3 6 5 4 4-7 4 7 5-4-2 13H5Z"/>',
        link: '<path d="m10 13 4-4m-6 6-2 2a3 3 0 0 1-4-4l5-5a3 3 0 0 1 4 0m2 5a3 3 0 0 0 4 0l5-5a3 3 0 0 0-4-4l-2 2"/>',
        warning: '<path d="m12 3 10 18H2Z"/><path d="M12 9v5m0 3h.01"/>',
        logout: '<path d="M9 3H3v18h6m5-14 5 5-5 5m-7-5h14"/>',
        edit: '<path d="m16 3 5 5-12 12-6 1 1-6Z"/><path d="m13 6 5 5"/>',
        trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
        sort: '<path d="M8 3v18m-4-4 4 4 4-4M16 3l4 4m-4-4-4 4m4-4v18"/>',
        play: '<path d="m9 5 11 7-11 7Z"/>',
        leaf: '<path d="M19 3C8 1 2 9 6 16c8 4 16-2 13-13Z"/><path d="M4 21 15 9m-7 6v-5m4 1h5"/>',
        bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M9 21h6"/>',
        shield: '<path d="m12 2 9 4v6c0 6-9 10-9 10S3 18 3 12V6Z"/><path d="m8 12 3 3 5-6"/>',
        globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c-5 5-5 13 0 18 5-5 5-13 0-18Z"/>'
    };
    Object.assign(paths, {
        user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
        lock: '<rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>',
        eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
        'eye-off': '<path d="m3 3 18 18M10.6 5.1 12 5c6 0 10 7 10 7a22 22 0 0 1-3.2 3.8M6.5 6.5A24 24 0 0 0 2 12s4 7 10 7a13 13 0 0 0 5.5-1.5M10 10a3 3 0 0 0 4 4"/>',
        external: '<path d="M14 3h7v7m0-7L10 14M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5"/>',
        download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
        pin: '<path d="m15 3 6 6-4 1-4 7-2-2-6 6 6-6-2-2 7-4Z"/>',
        refresh: '<path d="M20 7v5h-5M4 17v-5h5M5 8a8 8 0 0 1 13-3l2 2M4 17l2 2a8 8 0 0 0 13-3"/>'
    });
    function icon(name, cls) {
        return '<svg class="icon ' + (cls || '') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (paths[name] || paths.chat) + '</svg>';
    }
    function esc(value) {
        return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function button(label, action, id, cls, extra) {
        return '<button type="button" class="' + (cls || 'button') + '" data-action="' + action + '"' + (id ? ' data-id="' + esc(id) + '"' : '') + (extra || '') + '>' + label + '</button>';
    }
    function iconButton(name, label, action, id, cls) {
        return button(icon(name), action, id, 'icon-button ' + (cls || ''), ' aria-label="' + esc(label) + '" title="' + esc(label) + '"');
    }
    function mark() {
        return '<span class="brand-mark">' + icon('leaf') + '</span>';
    }
    function avatar(name, tone, size) {
        return '<span class="avatar tone-' + (tone || 'green') + ' ' + (size || '') + '">' + esc(name.slice(0, 1)) + '</span>';
    }
    function makeState(platform) {
        return {
            platform: platform, user: { name: '林晓', id: 'U1001', phone: '138 0000 0001', company: '青禾外贸' },
            theme: 'light', screen: platform === 'app' ? 'messages' : 'chat', layers: [], accountFilter: 'all',
            selectedContact: 'carlos', selectedCategory: 'common', messageQuery: '', itemQuery: '', bound: true,
            extensionConnected: true, whatsappLoggedIn: true, language: '简体中文', autoTranslate: true,
            accounts: [
                { id: 'mx', name: '墨西哥业务', number: '+52 5500000001', browser: 'Chrome · 办公电脑', connected: true, loggedIn: true, tone: 'green' },
                { id: 'us', name: '北美业务', number: '+1 2025550101', browser: 'Chrome · 笔记本', connected: true, loggedIn: false, tone: 'blue' },
                { id: 'ae', name: '中东业务', number: '+971 50 123 4567', browser: 'Chrome · 备用电脑', connected: false, loggedIn: true, tone: 'purple' }
            ],
            contacts: [
                { id: 'carlos', name: 'Carlos', country: '墨西哥', language: '西班牙语', account: 'mx', tone: 'orange', time: '09:41', unread: 3, preview: '请问订购 500 件可以优惠吗？', tag: '待报价', number: '+52 5500000101' },
                { id: 'ana', name: 'Ana Martínez', country: '墨西哥', language: '西班牙语', account: 'mx', tone: 'pink', time: '09:32', unread: 1, preview: '好的，谢谢！请把产品目录发给我。', tag: '重点客户', number: '+52 5500000102' },
                { id: 'carlos-us', name: 'Carlos', country: '美国', language: '英语', account: 'us', tone: 'blue', time: '09:15', unread: 0, preview: '你们支持定制产品包装吗？', tag: '新品意向', number: '+1 2025550110' },
                { id: 'maria', name: 'María López', country: '墨西哥', language: '西班牙语', account: 'mx', tone: 'purple', time: '昨天', unread: 0, preview: '[图片] 已收到包装图片，十分感谢。', tag: '', number: '+52 5500000112' },
                { id: 'omar', name: 'Omar Ahmed', country: '阿联酋', language: '英语', account: 'ae', tone: 'sand', time: '昨天', unread: 0, preview: '期待收到你的最新报价。', tag: '待报价', number: '+971 50 123 4588' }
            ],
            categories: [
                { id: 'common', name: '常用语', builtin: true, sort: 10, tone: 'blue' },
                { id: 'products', name: '产品介绍', builtin: true, sort: 20, tone: 'orange' },
                { id: 'quotation', name: '报价沟通', builtin: true, sort: 30, tone: 'purple' },
                { id: 'mexico', name: '墨西哥客户', builtin: false, sort: 40, tone: 'green' }
            ],
            items: [
                { id: 'greeting', category: 'common', title: '确认收到', text: '已收到您的需求，我会尽快确认后回复您。', image: '', autoReply: false, keywords: [] },
                { id: 'catalog', category: 'products', title: '产品图片', text: '', image: 'assets/product-package.svg', autoReply: false, keywords: [{ text: '图片', enabled: true }] },
                { id: 'quote', category: 'quotation', title: '询问采购数量', text: '请问您需要多少件？我可以按数量为您报价。', image: '', autoReply: true, keywords: [{ text: '数量', enabled: true }, { text: '报价', enabled: false }] },
                { id: 'packaging', category: 'mexico', title: '包装说明', text: '产品使用独立纸箱包装，可按订单要求确认包装方式。', image: 'assets/product-package.svg', autoReply: true, keywords: [{ text: '包装', enabled: true }] }
            ],
            feedback: [
                { id: 'FB1004', module: '类别', title: '常用语图片希望支持放大查看', content: '选择带图片的常用语时，希望先放大查看图片细节。', status: '已解决', date: '10月19日', client: 'Android', images: [], reply: '可以在常用语详情中点击图片查看大图。感谢你的建议。' },
                { id: 'FB1001', module: '客户资料', title: '返回客户列表后保留筛选条件', content: '查看客户资料后返回列表，希望保留刚才选择的账号和标签。', status: '待处理', date: '10月20日', client: 'Web', images: [], reply: '' }
            ],
            plans: [
                { id: 'pack10', name: '小额字符包', quota: '10 万', price: '9.90', unit: '/包', description: '180 天有效', type: 'pack' },
                { id: 'pack100', name: '常用字符包', quota: '100 万', price: '69', unit: '/包', description: '180 天有效', type: 'pack' },
                { id: 'basic', name: '基础月套餐', quota: '100 万', price: '49', unit: '/月', description: '每月字符额度', type: 'month' },
                { id: 'pro', name: '专业月套餐', quota: '300 万', price: '99', unit: '/月', description: '每月字符额度', type: 'month' },
                { id: 'high', name: '高频月套餐', quota: '1,000 万', price: '299', unit: '/月', description: '每月字符额度', type: 'month' },
                { id: 'year', name: '专业年套餐', quota: '300 万', price: '990', unit: '/年', description: '每月发放 · 连续 12 个月', type: 'year' }
            ],
            planType: 'month', sent: {}, orders: [], draftImage: ''
        };
    }
    function account(state, id) {
        return state.accounts.find(function (a) { return a.id === id; });
    }
    function contact(state) {
        return state.contacts.find(function (c) { return c.id === state.selectedContact; });
    }
    function sourceStatus(state, a) {
        const connected = a.id === 'mx' ? state.extensionConnected : a.connected;
        const loggedIn = a.id === 'mx' ? state.whatsappLoggedIn : a.loggedIn;
        return { connected: connected, loggedIn: loggedIn, ready: connected && loggedIn && state.bound };
    }
    function sourceBadge(state, a) {
        const status = sourceStatus(state, a);
        const label = status.ready ? '已连接' : '离线';
        return '<span class="connection-dot ' + (status.ready ? 'online' : 'offline') + '" role="img" aria-label="' + label + '" title="' + label + '"></span>';
    }
    function sourceProblem(state, a) {
        const status = sourceStatus(state, a);
        if (!status.connected) return '请打开电脑上的好麦 Chrome 扩展，或检查网络连接';
        if (!status.loggedIn) return '请在对应电脑登录 WhatsApp Web';
        if (!state.bound) return '请重新扫描好麦扩展的二维码，完成账号绑定';
        return '';
    }
    function searchBox(placeholder, scope, value) {
        return '<label class="search-box">' + icon('search') + '<input type="search" data-search="' + scope + '" value="' + esc(value || '') + '" placeholder="' + esc(placeholder) + '" aria-label="' + esc(placeholder) + '"></label>';
    }
    function contactRows(state) {
        const q = state.messageQuery.toLowerCase();
        const list = state.contacts.filter(function (c) {
            return (state.accountFilter === 'all' || c.account === state.accountFilter) && (!q || (c.name + c.preview + c.country).toLowerCase().includes(q));
        });
        if (!list.length) return '<div class="empty">' + icon('search') + '<h3>没有找到相关会话</h3><p>试试其他客户名或消息内容</p></div>';
        return list.map(function (c) {
            const a = account(state, c.account);
            return '<button class="contact-row ' + (state.selectedContact === c.id ? 'selected' : '') + '" data-action="contact" data-id="' + c.id + '">' + avatar(c.name, c.tone) + '<span class="contact-main"><span class="contact-title"><strong>' + esc(c.name) + '</strong><time>' + c.time + '</time></span><span class="contact-preview">' + esc(c.preview) + '</span><span class="contact-foot"><span class="account-label tone-' + a.tone + '">' + esc(a.name) + '</span><span class="language-tag">' + esc(c.language) + '</span></span></span>' + (c.unread ? '<span class="unread">' + c.unread + '</span>' : '') + '</button>';
        }).join('');
    }
    function categoryRows(state) {
        return state.categories.slice().sort(function (a, b) { return a.sort - b.sort; }).map(function (c) {
            return '<article class="category-row" data-category-id="' + c.id + '" role="listitem"><button class="category-open" data-action="category" data-id="' + c.id + '" aria-label="查看' + esc(c.name) + '详情"><span class="feature-icon tone-' + c.tone + '">' + icon('folder') + '</span><span class="category-main"><strong>' + esc(c.name) + '</strong><small>' + (c.builtin ? '系统内置' : '自定义') + '</small></span>' + icon('arrow') + '</button><button type="button" class="drag-handle" data-sort-handle="' + c.id + '" aria-label="拖动调整' + esc(c.name) + '的位置，也可按上下方向键" title="拖动调整位置">' + icon('grip') + '</button></article>';
        }).join('');
    }
    function itemCards(state, quick) {
        const list = state.items.filter(function (i) {
            return i.category === state.selectedCategory && (!state.itemQuery || (i.title + i.text + i.keywords.map(function (k) { return k.text; }).join()).includes(state.itemQuery));
        });
        if (!list.length) return '<div class="empty">' + icon('folder') + '<h3>这里还没有内容</h3><p>添加常用文字或图片，让回复更轻松</p></div>';
        return list.map(function (i) {
            return '<article class="item-card"><div class="item-card-head"><strong>' + esc(i.title) + '</strong><label class="switch item-auto-toggle" title="自动回复"><input type="checkbox" role="switch" data-auto-reply="' + i.id + '" aria-label="' + esc(i.title) + '的自动回复"' + (i.autoReply ? ' checked' : '') + '><span></span></label></div>' + (i.text ? '<p>' + esc(i.text) + '</p>' : '') + (i.image ? '<button class="image-preview" data-action="image" data-id="' + i.id + '"><img src="' + esc(i.image) + '" alt="' + esc(i.title) + '" loading="lazy"></button>' : '') + '<div class="keyword-chips">' + i.keywords.map(function (k) { return '<span class="keyword ' + (k.enabled ? '' : 'muted-keyword') + '">' + esc(k.text) + (k.enabled ? '' : ' · 停用') + '</span>'; }).join('') + '</div><footer>' + (quick ? button('填入输入框', 'use-item', i.id, 'button subtle small') : iconButton('arrow', '查看' + i.title + '详情', 'view-item', i.id, 'item-detail-link')) + '</footer></article>';
        }).join('');
    }
    function qr() {
        let svg = '<svg viewBox="0 0 29 29" xmlns="http://www.w3.org/2000/svg" aria-label="好麦扩展绑定二维码" role="img"><rect width="29" height="29" fill="white"/>';
        function finder(x, y) {
            svg += '<rect x="' + x + '" y="' + y + '" width="7" height="7" rx=".5" fill="#152820"/><rect x="' + (x + 1) + '" y="' + (y + 1) + '" width="5" height="5" fill="white"/><rect x="' + (x + 2) + '" y="' + (y + 2) + '" width="3" height="3" rx=".3" fill="#152820"/>';
        }
        for (let y = 2; y < 27; y++) {
            for (let x = 2; x < 27; x++) {
                if ((x < 10 && y < 10) || (x > 18 && y < 10) || (x < 10 && y > 18)) continue;
                if (((x * 17 + y * 13 + x * y * 3) % 11) < 5) svg += '<rect x="' + x + '" y="' + y + '" width="1" height="1" fill="#152820"/>';
            }
        }
        finder(2, 2); finder(20, 2); finder(2, 20);
        return svg + '</svg>';
    }
    window.Haomai = { icon: icon, esc: esc, button: button, iconButton: iconButton, mark: mark, avatar: avatar, makeState: makeState, account: account, contact: contact, sourceStatus: sourceStatus, sourceBadge: sourceBadge, sourceProblem: sourceProblem, searchBox: searchBox, contactRows: contactRows, categoryRows: categoryRows, itemCards: itemCards, qr: qr };
})();
