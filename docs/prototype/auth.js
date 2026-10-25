(function () {
    'use strict';
    const H = window.Haomai, e = H.esc, b = H.button;
    const clone = function (value) { return JSON.parse(JSON.stringify(value)); };
    H.createAuth = function (state, go) {
        state.hasSubscription = true;
        const initial = clone(state), initialAccount = state.user.phone.replace(/\s/g, '');
        const profiles = new Map([[initialAccount, { user: clone(state.user), password: 'haomai123' }]]);
        const workspaces = new Map();
        const keys = ['accounts', 'contacts', 'categories', 'items', 'feedback', 'orders', 'sent', 'selectedContact', 'selectedCategory', 'language', 'hasSubscription'];
        const codes = new Map();
        state.authenticated = true;
        function saveWorkspace() {
            if (!state.authenticated) return;
            const data = {};
            keys.forEach(function (key) { data[key] = clone(state[key]); });
            workspaces.set(state.user.phone.replace(/\s/g, ''), data);
        }
        saveWorkspace();
        function freshWorkspace() {
            const data = {};
            keys.forEach(function (key) { data[key] = clone(initial[key]); });
            data.categories = data.categories.filter(function (category) { return category.builtin; });
            data.items = []; data.feedback = []; data.orders = []; data.sent = {}; data.hasSubscription = false;
            if (state.platform === 'app') { data.accounts = []; data.contacts = []; data.selectedContact = ''; }
            else { data.accounts = data.accounts.filter(function (account) { return account.id === 'mx'; }); data.contacts = data.contacts.filter(function (contact) { return contact.account === 'mx'; }); }
            return data;
        }
        function useProfile(account) {
            saveWorkspace();
            const profile = profiles.get(account);
            Object.assign(state, clone(workspaces.get(account) || freshWorkspace()));
            // Workspace restoration must never replace the current UI session or route.
            state.user = clone(profile.user); state.authenticated = true;
            state.bound = state.platform === 'chrome' || state.accounts.length > 0;
            state.accountFilter = state.platform === 'chrome' ? 'mx' : 'all';
            state.messageQuery = ''; state.itemQuery = ''; state.draftText = ''; state.draftImage = ''; state.layers = [];
            go(state.platform === 'chrome' ? 'popup' : state.accounts.length ? 'messages' : 'connect-guide');
        }
        function authField(label, name, value, type, placeholder) {
            const password = type === 'password';
            return '<label class="field"><span>' + label + '</span><span class="auth-input">' + H.icon(password ? 'lock' : 'user') + '<input name="' + name + '" type="' + type + '" value="' + e(value) + '" placeholder="' + placeholder + '" autocomplete="' + (password ? name === 'password' && state.screen === 'login' ? 'current-password' : 'new-password' : 'username') + '"' + (!password ? ' inputmode="tel"' : '') + ' data-auth-input required>' + b(H.icon('close'), 'clear-auth-input', name, 'input-clear', ' aria-label="清空' + label + '"' + (value ? '' : ' hidden')) + (password ? b(H.icon('eye'), 'toggle-password', name, 'password-toggle', ' aria-label="显示' + label + '" aria-pressed="false"') : '') + '</span></label>';
        }
        function form(mode) {
            const login = mode === 'login', register = mode === 'register';
            const title = login ? '好麦，聊出好生意' : register ? '注册好麦' : '找回密码';
            const subtitle = login ? '让世界各地的客户，都聊得来。' : register ? '从这里开始，连接世界各地的客户。' : '验证手机号，设置新的登录密码。';
            return '<div class="auth-heading">' + H.mark() + '<h1>' + title + '</h1><p>' + subtitle + '</p></div>' +
                (state.authNotice && login ? '<p class="auth-notice" role="status">' + e(state.authNotice) + '</p>' : '') +
                '<form data-auth="' + mode + '" class="auth-form" novalidate>' + authField(login ? '账号' : '手机号', 'account', login ? state.authAccount || initialAccount : '', 'tel', '请输入手机号') +
                (!login && !register ? '<label class="field"><span>验证码</span><span class="verification-control"><input name="code" placeholder="6 位验证码" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required>' + b('获取验证码', 'request-code', null, 'text-button') + '</span></label>' : '') +
                authField(!login && !register ? '新密码' : '密码', 'password', '', 'password', '请输入密码') +
                (!login ? authField('确认密码', 'confirmPassword', '', 'password', '再次输入密码') : '') +
                '<p class="form-error" role="alert"></p><button type="submit" class="button primary block">' + (login ? '登录' : register ? '注册并登录' : '重置密码') + '</button></form>' +
                (login ? '<div class="auth-help-row">' + b('忘记密码', 'navigate', 'forgot-password', 'text-button') + '<span>还没账号？' + b('注册账号', 'navigate', 'register', 'text-button') + '</span></div>' : '<div class="auth-links"><span>已有账号？</span>' + b('返回登录', 'navigate', 'login', 'text-button') + '</div>');
        }
        document.addEventListener('input', function (event) {
            const input = event.target;
            if (!input.matches('[data-auth-input]')) return;
            const clear = input.parentElement.querySelector('.input-clear');
            clear.hidden = !input.value;
            const error = input.closest('form').querySelector('.form-error');
            if (error) error.textContent = '';
        });
        document.addEventListener('click', function (event) {
            const button = event.target.closest('[data-action="clear-auth-input"], [data-action="toggle-password"]');
            if (!button) return;
            event.preventDefault();
            const input = button.closest('.auth-input').querySelector('input');
            if (button.dataset.action === 'clear-auth-input') { input.value = ''; input.dispatchEvent(new Event('input', { bubbles: true })); }
            else {
                const visible = input.type === 'password';
                input.type = visible ? 'text' : 'password';
                button.innerHTML = H.icon(visible ? 'eye-off' : 'eye');
                button.setAttribute('aria-label', visible ? '隐藏密码' : '显示密码');
                button.setAttribute('aria-pressed', String(visible));
            }
            input.focus();
        });
        document.addEventListener('click', function (event) {
            const node = event.target.closest('[data-action="request-code"], [data-action="sign-out"]');
            if (!node) return;
            if (node.dataset.action === 'sign-out') {
                saveWorkspace(); state.authenticated = false; state.bound = false; state.authNotice = ''; state.authAccount = '';
                state.draftText = ''; state.draftImage = ''; go('login'); return;
            }
            const form = node.closest('form'), account = form.elements.account.value.trim();
            const error = form.querySelector('.form-error');
            if (!/^1\d{10}$/.test(account)) { error.textContent = '请输入有效的 11 位手机号'; return; }
            // Local interaction fixture only: no SMS request or network call is made.
            codes.set(account, '123456'); form.elements.code.value = '123456';
            node.textContent = '重新获取'; error.textContent = ''; form.elements.code.focus();
        });
        document.addEventListener('submit', function (event) {
            const form = event.target.closest('[data-auth]');
            if (!form) return;
            event.preventDefault();
            const account = form.elements.account.value.trim(), password = form.elements.password.value;
            const mode = form.dataset.auth, error = form.querySelector('.form-error');
            error.textContent = '';
            if (!/^1\d{10}$/.test(account)) { error.textContent = '请输入有效的 11 位手机号'; return; }
            if (!password.trim()) { error.textContent = '请输入密码'; return; }
            if (new TextEncoder().encode(password).length > 72) { error.textContent = '密码最多为 72 字节'; return; }
            if (mode === 'login') {
                const profile = profiles.get(account);
                if (!profile || profile.password !== password) { error.textContent = '账号或密码不正确'; return; }
                state.authNotice = ''; useProfile(account); return;
            }
            if (password !== form.elements.confirmPassword.value) { error.textContent = '两次输入的密码不一致'; return; }
            if (mode === 'register') {
                if (profiles.has(account)) { error.textContent = '该手机号已注册，请直接登录'; return; }
                profiles.set(account, { user: { id: 'U' + Date.now(), name: '用户' + account.slice(-4), phone: account, company: '' }, password: password });
                state.authAccount = account; state.authNotice = ''; useProfile(account); return;
            }
            if (!profiles.has(account) || !codes.has(account) || form.elements.code.value !== codes.get(account)) { error.textContent = '请检查账号与验证码'; return; }
            profiles.get(account).password = password; codes.delete(account);
            state.authAccount = account; state.authNotice = '密码已更新，请重新登录'; go('login');
        });
        return { form: form, fromScan: function () { useProfile(initialAccount); }, preview: function (screen) { useProfile(initialAccount); go(screen); } };
    };
})();
