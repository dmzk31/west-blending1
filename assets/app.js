(() => {
    'use strict';
    const $ = id => document.getElementById(id);
    const form = $('signupForm');
    const peopleElement = $('people');
    const submitButton = $('submitButton');
    const refreshButton = $('refreshButton');
    const districtInput = $('district');
    const otherDistrictInput = $('otherDistrict');
    const joinChoices = [
      ['10', '11:00 漯底山自然公園起'],
      ['14', '14:00 醒村起'],
      ['16', '16:00 岡山園起']
    ];
    const MAX_PERSONS = 40;
    const API_URL = 'https://script.google.com/macros/s/AKfycbylaNO_bS59MYR1ID0N5AHKjOyVRDsd5Dfu4_5uKqgLEATtm94_P7rrzASFt9uIEGqH8A/exec';
    let jsonpSequence = 0;
      // 照片由「手作.docx」轉為 assets 內的 WebP 靜態檔，無外部圖片服務依賴。
      const PHOTOS = Object.freeze({
        honey: [
          'assets/honey-1.webp',
          'assets/honey-2.webp'
        ],
        coffee: [
          'assets/coffee-1.webp',
          'assets/coffee-2.webp'
        ],
        bean: [
          'assets/bean-1.webp'
        ],
        art: [
          'assets/art-1.webp',
          'assets/art-2.webp'
        ],
        bamboo: [
          'assets/bamboo-1.webp'
        ]
      });
      const INFO_LINKS = Object.freeze({
        bean: [{ label: '品牌 Instagram', url: 'https://www.instagram.com/cheer.bean1949/' }],
        art: [{ label: '工作室 Instagram', url: 'https://www.instagram.com/drawstar_studio/' }],
        bamboo: [
          { label: '笙竹工坊 Facebook', url: 'https://www.facebook.com/ShengZhuGongFang/' },
          { label: '其他作品／材料費', url: 'https://docs.google.com/forms/d/e/1FAIpQLSffz6f8fbzfRYyk1jp6f64mnBOCErAXE66ex01VnaRV9h4Wgg/viewform' }
        ]
      });
    let activities = [];
    let dinner = {count:0,pricePerTable:4000,seatsPerTable:10};
    let ready = false;
    let submitting = false;
    let refreshing = false;
    let queryEpoch = 0;
    let nextKey = 1;
    let retry = null;

    const escapeHtml = value => String(value).replace(/[&<>"']/g, char =>
      ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char]);

    function showMessage(message, kind = '') {
      const node = $('message');
      node.hidden = !message;
      node.className = 'message' + (kind ? ' ' + kind : '');
      node.textContent = message;
    }

    function peopleCards() { return [...peopleElement.querySelectorAll('.person')]; }

    function createCard() {
      const key = nextKey++;
      const card = document.createElement('article');
      card.className = 'person';
      card.dataset.key = String(key);
      card.innerHTML = `
        <div class="person-head">
          <h3 class="person-title"></h3>
          <button type="button" class="remove" data-action="remove" hidden>刪除</button>
        </div>
        <div class="person-fields">
          <div class="field"><label for="name_${key}">姓名 <span aria-hidden="true">*</span></label>
            <input id="name_${key}" class="p-name" type="text" maxlength="30" autocomplete="off" required placeholder="請填姓名">
            <p class="field-error" id="error_name_${key}" role="alert" hidden></p></div>
          <div class="field"><label for="phone_${key}" class="phone-label">聯絡電話</label>
            <input id="phone_${key}" class="p-phone" type="tel" maxlength="25" autocomplete="off" placeholder="手機或電話">
            <p class="field-error" id="error_phone_${key}" role="alert" hidden></p></div>
          <div class="field"><label for="join_${key}">從哪一站加入？</label>
            <select id="join_${key}" class="p-join">${joinChoices.map(([value,label]) =>
              `<option value="${value}">${label}</option>`).join('')}</select></div>
          <div class="field"><label for="dinner_${key}">岡山園晚餐</label>
            <select id="dinner_${key}" class="p-dinner">
              <option value="yes">參加晚餐</option><option value="no">不參加晚餐</option>
            </select></div>
        </div>
        <fieldset class="activity-picker" tabindex="-1">
          <legend>選擇醒村手作 <span class="hint">（每人須選一項，含「不參加手作」；再按已選項可取消。16:00 加入者自動選擇。）</span></legend>
          <p class="join-restriction" hidden>16:00 從岡山園加入，已自動選擇「不參加手作」，無須另外操作。</p>
          <p class="field-error" id="error_activity_${key}" role="alert" hidden></p>
          <div class="workshops"><p class="note">正在載入手作資訊…</p></div>
        </fieldset>`;
      peopleElement.appendChild(card);
      renderPersonWorkshops(card);
      renumberCards();
      updateFormAvailability();
      return card;
    }

    function renumberCards() {
      const cards = peopleCards();
      cards.forEach((card,index) => {
        card.querySelector('.person-title').textContent = index === 0
          ? '報名者 1｜主報名者' : `報名者 ${index + 1}｜隨行者`;
        const phone = card.querySelector('.p-phone');
        phone.required = index === 0;
        card.querySelector('.phone-label').textContent = index === 0 ? '聯絡電話（必填）' : '聯絡電話（選填）';
        card.querySelector('.remove').hidden = index === 0;
      });
      $('peopleCount').textContent = '目前 ' + cards.length + ' 人';
      $('addPerson').disabled = submitting || cards.length >= MAX_PERSONS;
    }

    function selectedActivityId(card) {
      const input = card.querySelector('.p-activity:checked');
      return input ? input.value : '';
    }

    function errorGroup(control) {
      return control.classList.contains('activity-picker')
        ? control : control.closest('.field');
    }

    function clearFieldError(control) {
      const group = errorGroup(control);
      if (!group) return;
      group.classList.remove('is-invalid');
      const error = group.querySelector('.field-error');
      if (error) { error.hidden = true; error.textContent = ''; }
      if (control.hasAttribute('aria-invalid')) control.removeAttribute('aria-invalid');
      if (error && control.getAttribute('aria-describedby') === error.id) {
        control.removeAttribute('aria-describedby');
      }
    }

    function clearAllFieldErrors() {
      form.querySelectorAll('.is-invalid').forEach(group => {
        const control = group.classList.contains('activity-picker')
          ? group : group.querySelector('input,select');
        if (control) clearFieldError(control);
      });
    }

    function showFieldErrors(errors) {
      clearAllFieldErrors();
      if (!errors.length) return false;
      errors.forEach(({control, message}) => {
        const group = errorGroup(control);
        if (!group) return;
        const error = group.querySelector('.field-error');
        group.classList.add('is-invalid');
        control.setAttribute('aria-invalid', 'true');
        if (error) {
          error.textContent = message;
          error.hidden = false;
          control.setAttribute('aria-describedby', error.id);
        }
      });
      const first = errors[0].control;
      const group = errorGroup(first) || first;
      const focusTarget = first.classList.contains('activity-picker')
        ? first.querySelector('.p-activity:not(:disabled)') || first
        : first;
      focusTarget.focus({preventScroll: true});
      // 手作 fieldset 可能很高，應捲到錯誤提示而不是整個 fieldset 的中間。
      const scrollTarget = first.classList.contains('activity-picker')
        ? first.querySelector('.field-error') || first
        : group;
      scrollTarget.scrollIntoView({behavior: 'smooth', block: 'center'});
      showMessage(`尚有 ${errors.length} 項資料需要填寫或修正；已定位至第一個項目。`, 'error');
      return true;
    }

    function validateRequiredFields() {
      const errors = [];
      const add = (control, message) => errors.push({control, message});
      if (!districtInput.value) add(districtInput, '請選擇所屬大區。');
      if (districtInput.value === 'other') {
        const name = otherDistrictInput.value.trim();
        if (!name) add(otherDistrictInput, '請填寫其他大區名稱。');
        else if (/^[=+\-@]/.test(name)) add(otherDistrictInput, '大區名稱不能以特殊符號開頭。');
      }
      peopleCards().forEach((card, index) => {
        const prefix = `報名者 ${index + 1}`;
        const nameInput = card.querySelector('.p-name');
        const name = nameInput.value.trim();
        if (!name) add(nameInput, `${prefix}：請填寫姓名。`);
        else if (/^[=+\-@]/.test(name)) add(nameInput, `${prefix}：姓名不能以特殊符號開頭。`);
        const phoneInput = card.querySelector('.p-phone');
        const phone = phoneInput.value.trim();
        if (!phone && index === 0) {
          add(phoneInput, '主報名者：請填寫聯絡電話。');
        } else if (phone && (!/^[+0-9()\-\s]{7,25}$/.test(phone) || phone.replace(/\D/g, '').length < 7)) {
          add(phoneInput, `${prefix}：聯絡電話格式不正確，請檢查號碼。`);
        }
        if (!selectedActivityId(card)) {
          add(card.querySelector('.activity-picker'), `${prefix}：請選擇一項手作；不參加也要點選「不參加手作」。`);
        }
      });
      return !showFieldErrors(errors);
    }

    function renderPersonWorkshops(person) {
      const holder = person.querySelector('.workshops');
      if (!activities.length) return;
      const previous = selectedActivityId(person);
      const key = person.dataset.key;
      holder.innerHTML = activities.map(item => {
        const id = escapeHtml(item.id);
        const images = PHOTOS[item.id] || [];
        const media = images.length ? `<div class="choice-media${images.length === 1 ? ' single' : ''}">
          ${images.map((src, index) => `<button class="photo-trigger" type="button"
            data-photo="${id}" data-photo-index="${index}"
            aria-label="放大查看${escapeHtml(item.name)}第${index + 1}張照片">
              <img src="${src}" alt="${escapeHtml(item.name)}活動照片 ${index + 1}" loading="lazy" decoding="async">
            </button>`).join('')}</div>` : '';
        const links = INFO_LINKS[item.id] || [];
        const linkMarkup = links.length ? `<div class="choice-links">${links.map(link =>
          `<a href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(link.label)}</a>`
        ).join('')}</div>` : '';
        const inputId = `activity_${key}_${id}`;
        const recommended = item.id === 'honey';
        return `<article class="workshop${item.id === 'none' ? ' is-none' : ''}${recommended ? ' is-recommended' : ''}" data-activity="${id}">
          <div class="choice-main">
            ${media}
            <div class="choice-body">
              <div class="choice-head">
                <span class="choice-name">${escapeHtml(item.name)}</span>
                ${recommended ? '<strong class="recommendation-badge">★ 非常推薦 ★</strong>' : ''}
              </div>
              <span class="choice-description">${escapeHtml(item.description)}</span>
              <div class="choice-foot">
                <span class="fee">材料費：${escapeHtml(item.fee)}</span>
                ${item.capacity === null ? '' : '<span class="remaining"></span>'}
              </div>
            </div>
          </div>
          ${linkMarkup}
          <div class="choice-select">
            <input class="p-activity activity-radio" type="radio" id="${inputId}"
              name="activity_${key}" value="${id}" required${previous === item.id ? ' checked' : ''}>
            <label class="workshop-select" for="${inputId}">
              <span class="radio-dot" aria-hidden="true"></span>
              <span class="select-text">${previous === item.id ? '已選擇' : (item.id === 'none' ? '選擇不參加手作' : '選擇這項手作')}</span>
            </label>
          </div>
        </article>`;
      }).join('');
    }

    function updateFormAvailability() {
      if (!ready) return;
      const cards = peopleCards();
      // 16:00 加入者直接參加晚餐且不參加手作；這裡是唯一的自動選擇來源，
      // 可涵蓋切換加入時間、重新載入卡片與名額更新，不需手動點選。
      cards.forEach(card => {
        const onlyDinner = card.querySelector('.p-join').value === '16';
        const dinnerInput = card.querySelector('.p-dinner');
        dinnerInput.disabled = onlyDinner;
        if (onlyDinner) {
          dinnerInput.value = 'yes';
          const none = card.querySelector('.p-activity[value="none"]');
          if (none && !none.checked) {
            none.checked = true;
            clearFieldError(card.querySelector('.activity-picker'));
          }
        }
      });
      const counts = Object.create(null);
      cards.forEach(card => {
        const selected = selectedActivityId(card);
        if (selected) counts[selected] = (counts[selected] || 0) + 1;
      });
      const activityMap = Object.fromEntries(activities.map(item => [item.id, item]));
      const short = activities.some(item => item.capacity !== null &&
        (counts[item.id] || 0) > item.remaining);
      cards.forEach(card => {
        const selected = selectedActivityId(card);
        const onlyDinner = card.querySelector('.p-join').value === '16';
        card.querySelector('.join-restriction').hidden = !onlyDinner;
        card.querySelectorAll('.p-activity').forEach(input => {
          const item = activityMap[input.value];
          if (!item) return;
          const otherSelected = (counts[item.id] || 0) - (selected === item.id ? 1 : 0);
          const available = item.capacity === null || item.remaining > otherSelected;
          const selectable = !submitting && (!onlyDinner || item.id === 'none') &&
            (available || selected === item.id);
          input.disabled = !selectable;
          const choice = input.closest('.workshop');
          // 16:00 才加入者只能選「不參加手作」，直接隱藏其他無法參加的卡片。
          choice.hidden = onlyDinner && item.id !== 'none';
          const chosen = selected === item.id;
          choice.classList.toggle('selected', chosen);
          choice.classList.toggle('full', !available && !chosen && item.capacity !== null);
          choice.querySelector('.select-text').textContent = chosen ? '已選擇' :
            (!available && item.capacity !== null ? '名額已滿' : (item.id === 'none' ? '選擇不參加手作' : '選擇這項手作'));
          const info = choice.querySelector('.remaining');
          if (info) info.textContent = item.remaining <= 0
            ? '已額滿' : `剩餘 ${item.remaining}／${item.capacity} 名`;
        });
      });
      $('capacityNote').textContent = short
        ? '目前這批報名者選擇的人數超過剩餘手作名額，請調整後再送出。'
        : '每位報名者須選一項手作或「不參加手作」；16:00 加入者已自動選擇不參加手作。送出前會再次核對名額。';
      $('capacityNote').style.color = short ? 'var(--error)' : '';
      if (!submitting) submitButton.disabled = !ready || short;
      renderEstimate();
    }

    function formatMoney(value) {
      return '$' + value.toLocaleString('zh-TW');
    }

    function estimatedWorkshopFee(item) {
      if (!item) return null;
      if (item.id === 'none') return 0;
      // 只解析後端明確標示的金額，不能把「依課程內容」當成零元。
      const match = String(item.fee).trim().match(/^(?:NT\$|\$)?\s*([\d,]+)\s*元?$/);
      return match ? Number(match[1].replace(/,/g, '')) : null;
    }

    function renderEstimate() {
      if (!ready) return;
      const cards = peopleCards();
      const joinCount = cards.filter(card => card.querySelector('.p-dinner').value === 'yes').length;
      const registered = Number(dinner.count) || 0;
      const perDinner = 400;
      $('dinnerSummary').textContent = `岡山園晚餐：目前已報名 ${registered} 人，本次預計新增 ${joinCount} 人；費用暫以每人 ${formatMoney(perDinner)} 試算。`;

      let grandTotal = 0;
      let unpricedCount = 0;
      let unselectedCount = 0;
      const rows = cards.map((card, index) => {
        const name = card.querySelector('.p-name').value.trim() || `報名者 ${index + 1}`;
        const join = card.querySelector('.p-join').value;
        const joinLabel = (joinChoices.find(([value]) => value === join) || [null, '尚未選擇'])[1];
        const id = selectedActivityId(card);
        const workshop = activities.find(item => item.id === id);
        const fee = estimatedWorkshopFee(workshop);
        const attendingDinner = card.querySelector('.p-dinner').value === 'yes';
        const dinnerFee = attendingDinner ? perDinner : 0;
        const subtotal = (fee === null ? 0 : fee) + dinnerFee;
        grandTotal += subtotal;
        if (workshop && fee === null) unpricedCount++;
        if (!workshop) unselectedCount++;
        const feeText = !workshop ? '尚未選擇' : fee === null ? '費用待定' : formatMoney(fee);
        const totalText = formatMoney(subtotal) + (fee === null ? '＋待定' : '');
        const columns = [
          escapeHtml(name), escapeHtml(joinLabel),
          escapeHtml(workshop ? workshop.name : '尚未選擇'), feeText,
          attendingDinner ? formatMoney(dinnerFee) : '不參加', totalText
        ];
        const labels = ['報名者', '加入行程', '手作項目', '手作費', '晚餐預估', '個人小計'];
        return `<tr>${columns.map((value, cell) => `<td data-label="${labels[cell]}"${cell >= 3 ? ' class="amount"' : ''}>${value}</td>`).join('')}</tr>`;
      });
      $('estimateRows').innerHTML = rows.join('');
      const incomplete = unpricedCount > 0 || unselectedCount > 0;
      $('estimateTotalLabel').textContent = `本次 ${cards.length} 人${incomplete ? '目前可計算的預估合計' : '預估合計'}`;
      $('estimateTotal').textContent = formatMoney(grandTotal) + (incomplete ? '＋待定' : '');
      const unknown = $('estimateUnknown');
      unknown.hidden = !incomplete;
      if (incomplete) {
        const notices = [];
        if (unpricedCount) notices.push(`${unpricedCount} 人的手作材料費依實際課程決定，尚未計入`);
        if (unselectedCount) notices.push(`${unselectedCount} 人尚未選擇手作`);
        unknown.textContent = '尚未包含：' + notices.join('；') + '。以上不是最終應付總額。';
      }
    }

    function onCardChange(card, target) {
      if (target.classList.contains('p-activity')) {
        clearFieldError(card.querySelector('.activity-picker'));
      }
      updateFormAvailability();
    }

    function drawDistricts(items) {
      districtInput.replaceChildren(new Option('請選擇大區', ''));
      items.forEach(name => districtInput.add(new Option(name, name)));
      districtInput.add(new Option('其他（手動填寫）', 'other'));
      districtInput.disabled = false;
    }

    function toggleOtherDistrict() {
      clearFieldError(districtInput);
      clearFieldError(otherDistrictInput);
      const extra = districtInput.value === 'other';
      $('otherDistrictWrap').hidden = !extra;
      otherDistrictInput.required = extra;
      if (!extra) otherDistrictInput.value = '';
    }

    function normalizeActivities(items) {
      return items.map(item => item.id === 'none'
        ? {...item, capacity: null, remaining: null}
        : item);
    }

    function setPublicStatus(result) {
      activities = normalizeActivities(result.activities);
      dinner = result.dinner;
      updateFormAvailability();
    }

    class RegistrationError extends Error {}

    // GAS ContentService 不提供可供 GitHub Pages 讀取的跨來源 fetch 回應；
    // 公開資料與送出回執以 JSONP 讀取，資料寫入使用 no-cors POST。
    function callApi(action, params = {}) {
      return new Promise((resolve, reject) => {
        const callback = `__wbJsonp_${Date.now()}_${++jsonpSequence}`;
        const tag = document.createElement('script');
        const url = new URL(API_URL);
        url.searchParams.set('action', action);
        url.searchParams.set('callback', callback);
        url.searchParams.set('_', String(Date.now()));
        Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, String(value)));
        let done = false;
        const cleanup = () => {
          clearTimeout(timer);
          delete window[callback];
          tag.remove();
        };
        const complete = (error, result) => {
          if (done) return;
          done = true;
          cleanup();
          error ? reject(error) : resolve(result);
        };
        const timer = setTimeout(() => complete(new Error('連線逾時，請稍後再試。')), 20000);
        window[callback] = response => {
          if (!response || response.ok !== true) {
            complete(new Error(response?.error || '伺服器回傳資料格式錯誤。'));
          } else {
            complete(null, response);
          }
        };
        tag.onerror = () => complete(new Error('無法連線至報名系統，請檢查 GAS 部署權限與網路。'));
        tag.src = url.toString();
        document.head.appendChild(tag);
      });
    }

    async function submitRegistration(payload) {
      // POST 結果對跨網域瀏覽器是不透明的，必須用同一請求編號確認後端實際寫入。
      // 不依賴 opaque Response 判定成功，避免失敗卻顯示已報名。
      const send = fetch(API_URL, {
        method: 'POST',
        mode: 'no-cors',
        cache: 'no-store',
        headers: {'Content-Type': 'text/plain;charset=UTF-8'},
        body: JSON.stringify({action: 'register', payload})
      }).catch(() => null);
      const until = Date.now() + 90000;
      let lastError = null;
      while (Date.now() < until) {
        await new Promise(resolve => setTimeout(resolve, 1700));
        try {
          const response = await callApi('receipt', {requestId: payload.requestId});
          if (response.status === 'success') return response.data;
          if (response.status === 'error') return Promise.reject(new RegistrationError(response.error || '報名未完成。'));
        } catch (error) {
          if (error instanceof RegistrationError) throw error;
          lastError = error;
        }
      }
      await Promise.race([send, Promise.resolve()]);
      throw new Error('尚無法確認是否報名成功。請勿更換資料，稍後按「確認報名」重試，系統會使用相同請求編號防止重複寫入。' + (lastError ? '\n' + lastError.message : ''));
    }

    async function load() {
      refreshButton.disabled = true;
      const epoch = ++queryEpoch;
      try {
        const {data} = await callApi('initial');
        if (epoch !== queryEpoch) return;
        setPublicStatus(data);
        drawDistricts(data.districts);
        peopleCards().forEach(renderPersonWorkshops);
        ready = true;
        refreshButton.disabled = false;
        updateFormAvailability();
        showMessage('');
      } catch (error) {
        if (epoch !== queryEpoch) return;
        refreshButton.disabled = false;
        showMessage('載入失敗：' + (error.message || '請稍後重試。'), 'error');
      }
    }

    async function refresh() {
      if (!ready) { await load(); return; }
      if (refreshing || submitting || document.visibilityState === 'hidden') return;
      refreshing = true;
      refreshButton.disabled = true;
      const epoch = ++queryEpoch;
      try {
        const {data} = await callApi('availability');
        if (epoch !== queryEpoch) return;
        setPublicStatus(data);
      } catch (error) {
        if (epoch !== queryEpoch) return;
        showMessage('更新名額失敗，請按「更新名額」重試。', 'error');
      } finally {
        if (epoch === queryEpoch) {
          refreshing = false;
          refreshButton.disabled = false;
        }
      }
    }

    function requestId() {
      if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
      return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 14);
    }

    async function onSubmit(event) {
      event.preventDefault();
      if (!ready || submitting || $('successDialog').open) return;
      // 主動驗證並移動到第一個未填區塊；避免原生驗證攔截 submit 事件。
      if (!validateRequiredFields()) return;
      const people = peopleCards().map(card => ({
        name: card.querySelector('.p-name').value.trim(),
        phone: card.querySelector('.p-phone').value.trim(),
        joinTime: card.querySelector('.p-join').value,
        dinner: card.querySelector('.p-dinner').value === 'yes',
        activityId: selectedActivityId(card)
      }));
      if (people.some(person => !person.activityId)) {
        showMessage('請為每位報名者選擇手作或「不參加手作」。', 'error');
        return;
      }
      if (people.some(person => person.joinTime === '16' && person.activityId !== 'none')) {
        showMessage('16:00 才加入的報名者不能報名14:00手作。', 'error');
        return;
      }
      const count = Object.create(null);
      for (const person of people) count[person.activityId] = (count[person.activityId] || 0) + 1;
      const short = activities.some(item => item.capacity !== null && (count[item.id] || 0) > item.remaining);
      if (short) { showMessage('這批報名的手作名額不足，請先調整。', 'error'); return; }
      const payload = {
        district: districtInput.value,
        otherDistrict: otherDistrictInput.value,
        participants: people
      };
      const canonical = JSON.stringify(payload);
      if (!retry || retry.canonical !== canonical) retry = {canonical, id:requestId()};
      payload.requestId = retry.id;

      ++queryEpoch; // 送出前的名額查詢不得覆蓋提交後結果。
      submitting = true;
      submitButton.disabled = true;
      submitButton.textContent = '報名送出中…';
      refreshButton.disabled = true;
      $('addPerson').disabled = true;
      showMessage('正在確認所有報名者的手作名額…');
      try {
        const result = await submitRegistration(payload);
        retry = null;
        const notice = result.message;
        form.reset();
        clearAllFieldErrors();
        toggleOtherDistrict();
        peopleElement.replaceChildren();
        createCard();
        setPublicStatus(result);
        renumberCards();
        showMessage(notice, 'success');
        $('successMessage').textContent = notice;
        $('successDialog').showModal();
      } catch (error) {
        showMessage((error && error.message) || '報名失敗，請稍後重試。', 'error');
      } finally {
        submitting = false;
        refreshing = false;
        refreshButton.disabled = false;
        submitButton.textContent = '確認報名';
        renumberCards();
        updateFormAvailability();
        // 確認送出結果前不自動刷新，防止刷新訊息蓋過結果。
      }
    }

    peopleElement.addEventListener('click', event => {
      const selectLabel = event.target.closest('.workshop-select');
      if (selectLabel) {
        event.preventDefault(); // Prevent the label's native radio action; checked radios do not uncheck natively.
        const input = selectLabel.previousElementSibling;
        if (!submitting && input && input.classList.contains('p-activity') && !input.disabled) {
          input.checked = !input.checked;
          clearFieldError(input.closest('.activity-picker'));
          updateFormAvailability();
        }
        return;
      }
      const photo = event.target.closest('[data-photo]');
      if (photo) {
        const activity = photo.dataset.photo;
        const index = Number(photo.dataset.photoIndex);
        const item = activities.find(data => data.id === activity);
        const src = PHOTOS[activity] && PHOTOS[activity][index];
        if (!src || !item) return;
        $('lightboxImage').src = src;
        $('lightboxImage').alt = item.name + '活動照片 ' + (index + 1);
        $('lightboxCaption').textContent = item.name + '｜照片 ' + (index + 1) + '／' + PHOTOS[activity].length;
        $('lightbox').showModal();
        return;
      }
      if (submitting) return;
      const remove = event.target.closest('[data-action="remove"]');
      if (!remove) return;
      const card = remove.closest('.person');
      if (!card || card === peopleCards()[0]) return;
      card.remove();
      renumberCards();
      updateFormAvailability();
    });
    peopleElement.addEventListener('change', event => {
      const card = event.target.closest('.person');
      if (card) onCardChange(card, event.target);
    });
    peopleElement.addEventListener('keydown', event => {
      // 鍵盤操作與滑鼠一致：已選取的 radio 再按空白鍵可取消。
      const input = event.target.closest('.p-activity');
      if (!input || input.disabled || submitting) return;
      if ((event.code === 'Space' || event.key === ' ') && input.checked) {
        event.preventDefault();
        input.checked = false;
        clearFieldError(input.closest('.activity-picker'));
        updateFormAvailability();
      }
    });
    peopleElement.addEventListener('input', event => {
      if (event.target.classList.contains('p-name') || event.target.classList.contains('p-phone')) {
        clearFieldError(event.target);
      }
      if (event.target.classList.contains('p-name')) renderEstimate();
    });
    $('addPerson').addEventListener('click', () => {
      if (submitting || peopleCards().length >= MAX_PERSONS) return;
      const card = createCard();
      card.querySelector('.p-name').focus();
    });
    districtInput.addEventListener('change', toggleOtherDistrict);
    otherDistrictInput.addEventListener('input', () => clearFieldError(otherDistrictInput));
    refreshButton.addEventListener('click', refresh);
    form.addEventListener('submit', onSubmit);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') refresh();
    });
    $('successClose').addEventListener('click', () => $('successDialog').close());
    $('lightboxClose').addEventListener('click', () => $('lightbox').close());
    $('lightbox').addEventListener('click', event => {
      if (event.target === $('lightbox')) $('lightbox').close();
    });
    window.setInterval(refresh, 15000);
    createCard();
    load();
  })();
