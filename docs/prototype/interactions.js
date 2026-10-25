(function () {
    'use strict';
    const H = window.Haomai;
    const e = H.esc;
    const b = H.button;
    const ib = H.iconButton;
    const modules = ['账号与登录', '社交账号', '消息', '翻译', '客户资料', '客户跟进', '类别', 'AI 角色', '企业与成员', '套餐与订单', '设置', '其他'];
    function field(label, name, value, type, more) {
        const control = type === 'textarea' ? '<textarea name="' + name + '" rows="4"' + (more || '') + '>' + e(value) + '</textarea>' : '<input name="' + name + '" type="' + (type || 'text') + '" value="' + e(value) + '"' + (more || '') + '>';
        return '<label class="field"><span>' + label + '</span>' + control + '</label>';
    }
    function keywordRow(k) {
        return '<div class="keyword-row"><input aria-label="中文关键词" value="' + e(k.text) + '" placeholder="例如：报价"><label><input type="checkbox"' + (k.enabled ? ' checked' : '') + '> 启用</label>' + ib('close', '移除关键词', 'remove-keyword') + '</div>';
    }
    function editor(state, layer) {
        const item = state.items.find(function (i) { return i.id === layer.id; });
        const data = item || { title: '', category: state.selectedCategory, text: '', image: '', keywords: [], autoReply: false };
        return '<form data-form="item" data-id="' + e(data.id || '') + '" data-image="' + e(data.image) + '">' +
            field('标题 <small>选填</small>', 'title', data.title, 'text', ' placeholder="给内容起个容易找到的名字"') +
            '<label class="field"><span>类别</span><select name="category">' + state.categories.slice().sort(function (a, c) { return a.sort - c.sort; }).map(function (c) { return '<option value="' + c.id + '"' + (data.category === c.id ? ' selected' : '') + '>' + e(c.name) + '</option>'; }).join('') + '</select></label>' +
            field('文字 <small>与图片至少填写一项</small>', 'text', data.text, 'textarea', ' placeholder="输入常用回复，发送时转换为客户母语"') +
            '<div class="field"><span>图片 <small>选填</small></span><div class="upload-preview">' + imagePreview(data.image) + '</div><label class="upload-button">' + H.icon('image') + ' 添加图片<input class="visually-hidden" type="file" data-upload="item" accept="image/*"></label></div>' +
            '<div class="setting-row"><div><strong>自动回复</strong><small>仅在命中已启用的中文关键词时使用</small></div><label class="switch"><input name="autoReply" type="checkbox"' + (data.autoReply ? ' checked' : '') + '><span></span></label></div>' +
            '<div class="section-heading"><h3>中文关键词</h3>' + b(H.icon('plus') + ' 添加', 'add-keyword', null, 'text-button') + '</div><p class="help">非中文来信先译成中文，再匹配关键词。</p>' +
            '<div class="keyword-editor">' + data.keywords.map(keywordRow).join('') + '</div><p class="form-error" role="alert"></p><div class="form-actions">' + b('取消', 'close-layer', null, 'button') + '<button class="button primary" type="submit">保存内容</button></div></form>';
    }
    function imagePreview(src) {
        return src ? '<img class="uploaded-image" src="' + e(src) + '" alt="内容图片">' + b('移除图片', 'remove-image', null, 'text-button danger') : '<div class="upload-empty">支持纯文字、纯图片或图文内容</div>';
    }
    function categoryForm(state, layer) {
        const category = state.categories.find(function (c) { return c.id === layer.id; });
        return '<form data-form="category" data-id="' + (category ? category.id : '') + '">' +
            field('类别名称', 'name', category ? category.name : '', 'text', category && category.builtin ? ' readonly' : ' placeholder="例如：售后服务" required') +
            '<p class="form-error" role="alert"></p>' +
            '<div class="form-actions">' + b('取消', 'close-layer', null, 'button') + '<button class="button primary" type="submit">保存类别</button></div></form>';
    }
    function layers(state) {
        const layer = state.layers[state.layers.length - 1];
        if (!layer) return '';
        let title = '', content = '', cls = '', headAction = '';
        if (layer.type === 'items') {
            const category = state.categories.find(function (c) { return c.id === state.selectedCategory; });
            title = category.name;
            headAction = ib('plus', '添加内容', 'add-item');
            content = (!category.builtin ? '<div class="category-edit-link">' + b(H.icon('edit') + ' 编辑类别', 'manage-category', category.id, 'text-button') + '</div>' : '') + H.searchBox('搜索标题、内容或关键词', 'items', state.itemQuery) + '<div class="item-list">' + H.itemCards(state, false) + '</div>';
        } else if (layer.type === 'item') {
            const item = state.items.find(function (i) { return i.id === layer.id; });
            title = item.title;
            content = (item.text ? '<p class="detail-text">' + e(item.text) + '</p>' : '') + (item.image ? '<button class="image-preview large" data-action="image" data-id="' + item.id + '"><img src="' + e(item.image) + '" alt="' + e(item.title) + '"></button>' : '') + '<p class="help">中文关键词</p><div class="keyword-chips">' + item.keywords.map(function (k) { return '<span class="keyword">' + e(k.text) + (k.enabled ? '' : ' · 停用') + '</span>'; }).join('') + '</div><div class="form-actions">' + b('编辑内容', 'edit-item', item.id, 'button primary') + b('删除', 'delete-item', item.id, 'button danger') + '</div>';
        } else if (layer.type === 'edit-item') {
            title = layer.id ? '编辑内容' : '添加内容'; content = editor(state, layer);
        } else if (layer.type === 'category') {
            title = layer.id ? '编辑类别' : '添加类别'; content = categoryForm(state, layer);
            const c = state.categories.find(function (item) { return item.id === layer.id; });
            if (c && !c.builtin) content += b('删除这个类别', 'delete-category', c.id, 'text-button danger block');
        } else if (layer.type === 'confirm') {
            title = layer.title; content = '<div class="confirm-icon">' + H.icon('warning') + '</div><p class="detail-text">' + e(layer.message) + '</p><div class="form-actions">' + b('取消', 'close-layer', null, 'button') + b('确认删除', 'confirm-delete', null, 'button destructive') + '</div>'; cls = 'compact-dialog';
        } else if (layer.type === 'quick') {
            title = '选择内容'; content = '<div class="chips">' + state.categories.slice().sort(function (a, c) { return a.sort - c.sort; }).map(function (c) { return b(e(c.name), 'quick-category', c.id, 'chip ' + (c.id === state.selectedCategory ? 'active' : '')); }).join('') + '</div><div class="item-list">' + H.itemCards(state, true) + '</div>';
        } else if (layer.type === 'image') {
            title = '查看图片'; const item = state.items.find(function (i) { return i.id === layer.id; });
            content = '<img class="full-image" src="' + e(item ? item.image : layer.src) + '" alt="图片详情">'; cls = 'image-dialog';
        } else if (layer.type === 'feedback') {
            title = '提交意见反馈'; content = '<form data-form="feedback" data-images="[]"><label class="field"><span>功能模块</span><select name="module">' + modules.map(function (m) { return '<option>' + m + '</option>'; }).join('') + '</select></label>' + field('问题描述', 'content', '', 'textarea', ' placeholder="描述你遇到的问题或想法" required') + '<div class="field"><span>相关图片 <small>选填，可添加多张</small></span><div class="feedback-images"></div><label class="feedback-add-image" aria-label="添加图片">' + H.icon('plus') + '<input class="visually-hidden" data-upload="feedback" type="file" accept="image/*" aria-label="添加反馈图片" multiple></label></div><p class="form-error" role="alert"></p><div class="form-actions"><button class="button primary" type="submit">提交反馈</button></div></form>';
        } else if (layer.type === 'feedback-detail') {
            const f = state.feedback.find(function (i) { return i.id === layer.id; });
            title = '反馈详情'; content = '<span class="pill green">' + f.status + '</span><h3 class="spaced">' + e(f.title) + '</h3><p class="detail-text">' + e(f.content) + '</p><p class="help">' + f.module + ' · ' + f.client + ' · ' + f.date + '</p><div class="feedback-images">' + f.images.map(function (src) { return '<img src="' + e(src) + '" alt="反馈图片" data-action="feedback-image" data-src="' + e(src) + '">'; }).join('') + '</div><div class="reply-card"><strong>好麦团队</strong><p>' + e(f.reply || '反馈已收到，我们会尽快处理。你可以在这里查看回复。') + '</p></div>';
        } else if (layer.type === 'customer') {
            const c = H.contact(state); title = '客户资料'; content = '<div class="profile-hero">' + H.avatar(c.name, c.tone, 'large') + '<h2>' + e(c.name) + '</h2><p>' + c.country + ' · ' + c.number + '</p></div><div class="info-row"><span>来源账号</span><strong>' + H.account(state, c.account).name + '</strong></div><div class="info-row"><span>客户母语</span><strong>' + c.language + '</strong></div><div class="info-row"><span>客户标签</span><strong>' + (c.tag || '未设置') + '</strong></div><div class="note">' + H.icon('shield') + ' 当前会话始终通过此来源账号回复。</div>';
        } else if (layer.type === 'language') {
            title = '我的母语'; content = '<p class="help">用于阅读来信译文和撰写回复。客户母语按会话单独设置。</p>' + ['简体中文', '英语', '西班牙语', '阿拉伯语'].map(function (lang) { return b('<span>' + lang + '</span>' + (state.language === lang ? H.icon('check') : ''), 'language', lang, 'selection-row'); }).join('');
        } else if (layer.type === 'reply-language') {
            const contact = H.contact(state), selected = contact.replyLanguage || contact.language;
            title = '发送语言'; content = ['简体中文', '英语', '西班牙语', '阿拉伯语'].map(function (lang) { return b('<span>' + lang + '</span>' + (selected === lang ? H.icon('check') : ''), 'reply-language', lang, 'selection-row', ' aria-pressed="' + (selected === lang) + '"'); }).join('');
        } else if (layer.type === 'extension-qr') {
            title = '连接手机'; cls = 'compact-dialog';
            content = '<div class="qr-account">' + H.avatar(state.user.name, 'green') + '<div><strong>' + e(state.user.name) + '</strong><p>' + e(state.user.phone) + '</p></div></div><div class="qr-wrap">' + H.qr() + '</div><p class="qr-caption">使用同一好麦账号，在 App 中扫一扫</p>' + b(H.icon('scan') + ' 刷新二维码', 'refresh-qr', null, 'text-button popup-refresh');
        } else if (layer.type === 'order') {
            const p = state.plans.find(function (plan) { return plan.id === layer.id; });
            title = '确认订单'; content = '<h2 class="spaced">' + p.name + '</h2><div class="info-row"><span>字符额度</span><strong>' + p.quota + (p.type === 'year' ? ' / 月' : '') + '</strong></div><div class="info-row"><span>有效期 / 发放</span><strong>' + p.description + '</strong></div><div class="info-row"><span>原价</span><strong>¥' + p.price + '</strong></div><div class="info-row"><span>应付金额</span><strong class="price">¥' + p.price + '</strong></div><p class="help">确认后可在订单中查看支付状态。</p>' + b('提交订单', 'create-order', p.id, 'button primary block');
         } else if (layer.type === 'theme-picker') {
            title = '深色模式'; cls = 'theme-dialog';
            content = [['dark', '深色模式'], ['light', '浅色模式'], ['system', '跟随系统']].map(function (option) {
                return b('<span>' + option[1] + '</span>' + (state.themeMode === option[0] ? H.icon('check') : ''), 'choose-theme', option[0], 'selection-row', ' role="radio" aria-checked="' + (state.themeMode === option[0]) + '"');
            }).join('');
            content = '<div role="radiogroup" aria-label="深色模式">' + content + '</div>';
        } else if (layer.type === 'notice') {
            title = layer.title; content = '<p class="detail-text">' + e(layer.message) + '</p>' + b('知道了', 'close-layer', null, 'button primary block'); cls = 'compact-dialog';
        }
        return '<div class="scrim" data-action="backdrop"></div><section class="dialog ' + cls + '" role="dialog" aria-modal="true" aria-label="' + e(title) + '"><header class="dialog-head">' + (state.layers.length > 1 ? ib('back', '返回', 'close-layer') : '') + '<h2>' + e(title) + '</h2>' + headAction + ib('close', '关闭', 'close-layer') + '</header><div class="dialog-body">' + content + '</div></section>';
    }
    function feedbackList(state) {
        return state.feedback.map(function (f) { return '<button class="feedback-row" data-action="feedback-detail" data-id="' + f.id + '"><span class="pill ' + (f.status === '已解决' ? 'green' : 'amber') + '">' + f.status + '</span><strong>' + e(f.title) + '</strong><p>' + e(f.reply || f.content) + '</p><small>' + f.date + ' · ' + f.client + (f.images.length ? ' · ' + f.images.length + ' 张图片' : '') + '</small></button>'; }).join('');
    }
    function plans(state) {
        return '<div class="plan-segments" role="tablist" aria-label="套餐类型">' + [['month', '月套餐'], ['year', '年套餐'], ['pack', '字符包']].map(function (p) { return b(p[1], 'plan-type', p[0], state.planType === p[0] ? 'active' : '', ' role="tab" aria-selected="' + (state.planType === p[0]) + '"'); }).join('') + '</div><div class="plan-grid">' + state.plans.filter(function (p) { return p.type === state.planType; }).map(function (p) {
            const selected = p.id === state.selectedPlan;
            return b('<span class="plan-select-mark">' + (selected ? H.icon('check') : '') + '</span><span class="plan-option-copy"><strong>' + e(p.name) + '</strong><span class="plan-option-quota">' + p.quota + ' 字符' + (p.type === 'pack' ? '' : ' / 月') + '</span><small>' + p.description + '</small></span><span class="plan-option-price">¥' + p.price + '<small>' + p.unit + '</small></span>', 'select-plan', p.id, 'plan-option ' + (selected ? 'selected' : ''), ' aria-pressed="' + selected + '"');
        }).join('') + '</div>' + (state.orders.length ? '<div class="order-list"><h3>我的订单</h3>' + state.orders.map(function (o) { return '<div class="info-row"><span>' + o.name + '<small>' + o.id + '</small></span><strong>¥' + o.price + ' · 待支付</strong></div>'; }).join('') + '</div>' : '');
    }
    function wire(state, render, go, extras) {
        let toastTimer;
        let returnFocus;
        function toast(message) {
            const node = document.getElementById('toast');
            node.textContent = message; node.classList.add('show');
            clearTimeout(toastTimer);
            toastTimer = setTimeout(function () { node.classList.remove('show'); }, 2500);
        }
        function refreshLayers() {
            document.getElementById('layers').innerHTML = layers(state);
            const first = document.querySelector('#layers .dialog button, #layers .dialog input');
            if (first) first.focus();
        }
        function open(type, info) {
            returnFocus = document.activeElement && { action: document.activeElement.dataset.action, id: document.activeElement.dataset.id };
            state.layers.push(Object.assign({ type: type }, info || {}));
            refreshLayers();
        }
        function close() {
            state.layers.pop(); refreshLayers();
            if (!state.layers.length && returnFocus) {
                const target = Array.from(document.querySelectorAll('[data-action]')).find(function (node) { return node.dataset.action === returnFocus.action && node.dataset.id === returnFocus.id; });
                if (target) target.focus();
            }
        }
        document.addEventListener('click', function (event) {
            const node = event.target.closest('[data-action]');
            if (!node) return;
            const action = node.dataset.action, id = node.dataset.id;
            if (action === 'backdrop' && event.target !== node) return;
            if (action === 'close-layer' || action === 'backdrop') return close();
            if (action === 'category') {
                state.selectedCategory = id; state.itemQuery = ''; open('items'); return;
            }
            if (action === 'manage-category') return open('category', { id: id });
            if (action === 'add-category') return open('category');
            if (action === 'add-item' || action === 'edit-item') return open('edit-item', { id: id });
            if (action === 'quick') { state.itemQuery = ''; return open('quick'); }
            if (action === 'quick-category') { state.selectedCategory = id; refreshLayers(); return; }
            if (action === 'image') return open('image', { id: id });
            if (action === 'feedback-image') return open('image', { src: node.dataset.src });
            if (action === 'feedback') return open('feedback');
            if (action === 'feedback-detail') return open('feedback-detail', { id: id });
            if (action === 'customer') return open('customer');
            if (action === 'view-item') return open('item', { id: id });
            if (action === 'select-language') return open('language');
            if (action === 'language') { state.language = id; state.layers = []; render(); toast('我的母语已更新'); return; }
            if (action === 'select-reply-language') return open('reply-language');
            if (action === 'reply-language') { H.contact(state).replyLanguage = id; state.layers.pop(); render(); return; }
            if (action === 'order') return open('order', { id: id });
            if (action === 'plan-type') { state.planType = id; render(); return; }
            if (action === 'create-order') {
                const plan = state.plans.find(function (p) { return p.id === id; });
                state.orders.push(Object.assign({}, plan, { id: 'HM' + Date.now().toString().slice(-8) }));
                state.layers = []; render(); toast('订单已创建，等待支付'); return;
            }
            if (action === 'delete-item') {
                const item = state.items.find(function (i) { return i.id === id; });
                return open('confirm', { target: 'item', id: id, title: '删除内容', message: '确认删除“' + item.title + '”？关联关键词会同时移除，该内容将不再参与自动回复。' });
            }
            if (action === 'delete-category') {
                const c = state.categories.find(function (i) { return i.id === id; });
                if (state.items.some(function (i) { return i.category === id; })) {
                    return toast('请先移动或删除该类别中的内容');
                }
                if (!c.builtin) return open('confirm', { target: 'category', id: id, title: '删除类别', message: '确认删除空类别“' + c.name + '”？' });
                return;
            }
            if (action === 'confirm-delete') {
                const layer = state.layers[state.layers.length - 1];
                if (layer.target === 'item') {
                    state.items = state.items.filter(function (i) { return i.id !== layer.id; });
                    state.layers = state.layers.filter(function (l) { return l.type !== 'confirm' && l.type !== 'item' && l.type !== 'edit-item'; });
                } else {
                    const c = state.categories.find(function (i) { return i.id === layer.id; });
                    if (!c || c.builtin || state.items.some(function (i) { return i.category === c.id; })) return;
                    state.categories = state.categories.filter(function (i) { return i.id !== c.id; }); state.layers = [];
                }
                render(); toast('已删除'); return;
            }
            if (action === 'add-keyword') {
                document.querySelector('.keyword-editor').insertAdjacentHTML('beforeend', keywordRow({ text: '', enabled: true }));
                const inputs = document.querySelectorAll('.keyword-row > input'); inputs[inputs.length - 1].focus(); return;
            }
            if (action === 'remove-keyword') { node.closest('.keyword-row').remove(); return; }
            if (action === 'remove-image') {
                const form = node.closest('form'); form.dataset.image = ''; form.querySelector('.upload-preview').innerHTML = imagePreview(''); return;
            }
            if (action === 'remove-feedback-image') {
                const form = node.closest('form'), images = JSON.parse(form.dataset.images);
                images.splice(Number(id), 1); form.dataset.images = JSON.stringify(images);
                updateFeedbackImages(form, images); return;
            }
            if (extras && extras(action, id, node, { open: open, close: close, toast: toast, refreshLayers: refreshLayers }) === true) return;
        });
        document.addEventListener('input', function (event) {
            const input = event.target;
            if (input.dataset.search === 'items') {
                state.itemQuery = input.value.trim();
                document.querySelector('#layers .item-list').innerHTML = H.itemCards(state, false);
            }
            if (input.dataset.search === 'messages') {
                state.messageQuery = input.value.trim();
                const list = document.querySelector('.contacts-list');
                if (list) list.innerHTML = H.contactRows(state);
            }
        });
        function updateFeedbackImages(form, images) {
            form.querySelector('.feedback-images').innerHTML = images.map(function (src, index) {
                return '<span class="feedback-image"><img src="' + e(src) + '" alt="反馈图片 ' + (index + 1) + '">' + ib('close', '移除图片', 'remove-feedback-image', String(index)) + '</span>';
            }).join('');
        }
        document.addEventListener('change', function (event) {
            const input = event.target, type = input.dataset.upload;
            if (input.dataset.autoReply) {
                const item = state.items.find(function (entry) { return entry.id === input.dataset.autoReply; });
                if (input.checked && !item.keywords.some(function (keyword) { return keyword.enabled; })) {
                    input.checked = false; toast('请先在详情中配置并启用中文关键词'); return;
                }
                item.autoReply = input.checked; refreshLayers(); return;
            }
            if (!type || !input.files.length) return;
            const form = input.closest('form');
            Array.from(input.files).forEach(function (file) {
                if (!file.type.startsWith('image/')) { toast('请选择图片文件'); return; }
                const reader = new FileReader();
                reader.onload = function () {
                    if (!form || !form.isConnected) return;
                    if (type === 'item') { form.dataset.image = reader.result; form.querySelector('.upload-preview').innerHTML = imagePreview(reader.result); }
                    if (type === 'feedback') {
                        const images = JSON.parse(form.dataset.images); images.push(reader.result);
                        form.dataset.images = JSON.stringify(images); updateFeedbackImages(form, images);
                    }
                };
                reader.readAsDataURL(file);
            });
        });
        document.addEventListener('submit', function (event) {
            const form = event.target.closest('[data-form]');
            if (!form) return;
            if (!['category', 'item', 'feedback'].includes(form.dataset.form)) return;
            event.preventDefault();
            const data = new FormData(form);
            function error(message) { form.querySelector('.form-error').textContent = message; }
            if (form.dataset.form === 'category') {
                const name = String(data.get('name') || '').trim();
                if (!name) return error('请输入类别名称');
                if (state.categories.some(function (c) { return c.id !== form.dataset.id && c.name.toLowerCase() === name.toLowerCase(); })) return error('已有同名类别');
                const c = state.categories.find(function (i) { return i.id === form.dataset.id; });
                if (c) { if (!c.builtin) c.name = name; }
                else state.categories.push({ id: 'cat' + Date.now(), name: name, sort: Math.max(0, ...state.categories.map(function (category) { return category.sort; })) + 10, builtin: false, tone: 'purple' });
                state.layers.pop(); render(); toast('类别已保存'); return;
            }
            if (form.dataset.form === 'item') {
                const text = String(data.get('text') || '').trim(), image = form.dataset.image;
                if (!text && !image) return error('请填写文字或添加图片');
                const keywords = [], rows = Array.from(form.querySelectorAll('.keyword-row'));
                for (const row of rows) {
                    const word = row.querySelector('input').value.trim();
                    if (!/\p{Script=Han}/u.test(word) || !/^[\p{Script=Han}\p{N}\p{P}\p{Zs}]+$/u.test(word)) return error('关键词请只填写中文');
                    if (keywords.some(function (k) { return k.text === word; })) return error('请勿重复填写关键词');
                    keywords.push({ text: word, enabled: row.querySelector('input[type="checkbox"]').checked });
                }
                const autoReply = data.has('autoReply');
                if (autoReply && !keywords.some(function (k) { return k.enabled; })) return error('请至少添加并启用一个中文关键词');
                const item = state.items.find(function (i) { return i.id === form.dataset.id; });
                const value = { id: item ? item.id : 'item' + Date.now(), category: String(data.get('category')), title: String(data.get('title') || '').trim() || text.slice(0, 24) || '图片内容', text: text, image: image, autoReply: autoReply, keywords: keywords };
                if (item) Object.assign(item, value); else state.items.push(value);
                state.layers.pop(); render(); toast('内容已保存'); return;
            }
            if (form.dataset.form === 'feedback') {
                const content = String(data.get('content') || '').trim();
                if (!content) return error('请填写问题描述');
                state.feedback.unshift({ id: 'FB' + Date.now(), module: String(data.get('module')), title: content.slice(0, 28), content: content, status: '待处理', date: '刚刚', client: state.platform === 'app' ? 'Android' : 'Chrome', images: JSON.parse(form.dataset.images), reply: '' });
                state.layers = []; go('feedback'); toast('反馈已提交'); return;
            }
        });
        // Pointer events support dragging with both a mouse and a touch screen.
        // Only the handle starts a drag, so opening a category stays a single action.
        let drag;
        function categoryOrder() {
            return state.categories.slice().sort(function (a, c) { return a.sort - c.sort; }).map(function (c) { return c.id; });
        }
        function saveOrder(ids, focusedId) {
            ids.forEach(function (id, index) { state.categories.find(function (c) { return c.id === id; }).sort = (index + 1) * 10; });
            render();
            const handle = document.querySelector('[data-sort-handle="' + focusedId + '"]');
            if (handle) handle.focus();
            toast('类别位置已调整');
        }
        function moveDraggedRow() {
            if (!drag || !drag.started) return;
            const rows = drag.ids.filter(function (id) { return id !== drag.id; }).map(function (id) { return Array.from(drag.list.children).find(function (row) { return row.dataset.categoryId === id; }); });
            let index = rows.findIndex(function (row) { const rect = row.getBoundingClientRect(); return drag.y < rect.top + rect.height / 2; });
            if (index < 0) index = rows.length;
            drag.ids = rows.map(function (row) { return row.dataset.categoryId; });
            drag.ids.splice(index, 0, drag.id);
            // Keep nodes in the DOM so pointer capture survives a visual reorder.
            Array.from(drag.list.children).forEach(function (row) { row.style.order = drag.ids.indexOf(row.dataset.categoryId); });
        }
        function scrollDraggedList() {
            if (!drag || !drag.started) return;
            const rect = drag.scroll.getBoundingClientRect();
            if (drag.y < rect.top + 44) drag.scroll.scrollTop -= 6;
            else if (drag.y > rect.bottom - 44) drag.scroll.scrollTop += 6;
            moveDraggedRow();
            drag.frame = requestAnimationFrame(scrollDraggedList);
        }
        function finishDrag(cancelled) {
            if (!drag) return;
            const current = drag;
            drag = null;
            cancelAnimationFrame(current.frame);
            current.row.classList.remove('dragging');
            current.handle.classList.remove('grabbing');
            if (current.handle.hasPointerCapture && current.handle.hasPointerCapture(current.pointer)) current.handle.releasePointerCapture(current.pointer);
            if (!current.started) return;
            const ids = current.ids;
            if (!cancelled && ids.join() !== categoryOrder().join()) saveOrder(ids, current.id);
            else render();
        }
        document.addEventListener('pointerdown', function (event) {
            const handle = event.target.closest ? event.target.closest('[data-sort-handle]') : null;
            if (!handle || state.layers.length || event.button !== 0 || event.isPrimary === false) return;
            if (drag) finishDrag(true);
            event.preventDefault();
            handle.focus();
            drag = { id: handle.dataset.sortHandle, ids: categoryOrder(), pointer: event.pointerId, handle: handle, row: handle.closest('.category-row'), list: handle.closest('.category-list'), scroll: handle.closest('.page-scroll'), startY: event.clientY, y: event.clientY, started: false };
            if (handle.setPointerCapture) handle.setPointerCapture(event.pointerId);
        });
        document.addEventListener('pointermove', function (event) {
            if (!drag || event.pointerId !== drag.pointer) return;
            drag.y = event.clientY;
            if (!drag.started && Math.abs(drag.y - drag.startY) < 5) return;
            event.preventDefault();
            if (!drag.started) {
                drag.started = true;
                drag.row.classList.add('dragging');
                drag.handle.classList.add('grabbing');
                drag.frame = requestAnimationFrame(scrollDraggedList);
            }
            moveDraggedRow();
        }, { passive: false });
        document.addEventListener('pointerup', function (event) { if (drag && event.pointerId === drag.pointer) finishDrag(false); });
        document.addEventListener('pointercancel', function (event) { if (drag && event.pointerId === drag.pointer) finishDrag(true); });
        document.addEventListener('lostpointercapture', function (event) { if (drag && event.pointerId === drag.pointer) finishDrag(true); });
        window.addEventListener('blur', function () { finishDrag(true); });
        document.addEventListener('keydown', function (event) {
            if (event.key === 'Escape' && drag) { finishDrag(true); return; }
            const handle = event.target.closest ? event.target.closest('[data-sort-handle]') : null;
            if (handle && !state.layers.length && ['ArrowUp', 'ArrowDown'].includes(event.key)) {
                event.preventDefault();
                const ids = categoryOrder(), from = ids.indexOf(handle.dataset.sortHandle), to = from + (event.key === 'ArrowUp' ? -1 : 1);
                if (to >= 0 && to < ids.length) { const id = ids.splice(from, 1)[0]; ids.splice(to, 0, id); saveOrder(ids, id); }
                return;
            }
            if (event.key === 'Escape' && state.layers.length) close();
            if (event.key === 'Tab' && state.layers.length) {
                const nodes = Array.from(document.querySelectorAll('#layers .dialog button, #layers .dialog input, #layers .dialog select, #layers .dialog textarea')).filter(function (n) { return !n.disabled && n.getClientRects().length; });
                if (!nodes.length) return;
                if (event.shiftKey && document.activeElement === nodes[0]) { event.preventDefault(); nodes[nodes.length - 1].focus(); }
                if (!event.shiftKey && document.activeElement === nodes[nodes.length - 1]) { event.preventDefault(); nodes[0].focus(); }
            }
        });
        document.addEventListener('error', function (event) {
            if (event.target.tagName === 'IMG') {
                event.target.classList.add('image-unavailable'); event.target.alt = '图片暂时无法显示';
            }
        }, true);
        return { open: open, close: close, toast: toast, refreshLayers: refreshLayers };
    }
    Object.assign(H, { field: field, layers: layers, feedbackList: feedbackList, plans: plans, wire: wire });
})();
