// ==================== Storage ====================
const DB = {
  get: (key, def = null) => {
    try { return JSON.parse(localStorage.getItem(key)) ?? def; } catch { return def; }
  },
  set: (key, val) => localStorage.setItem(key, JSON.stringify(val)),
};

// ==================== State ====================
let recipes = DB.get('recipes', []);
let mealPlan = DB.get('mealPlan', {});
let shoppingList = DB.get('shoppingList', []);
let currentWeekStart = getMonday(new Date());
let editingRecipeId = null;
let pendingMealSlot = null;
let aiPlanData = null;

// ==================== Helpers ====================
function getMonday(d) {
  const date = new Date(d);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

function formatDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function isToday(d) {
  const t = new Date();
  return d.getDate() === t.getDate() && d.getMonth() === t.getMonth() && d.getFullYear() === t.getFullYear();
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function showToast(msg, duration = 2500) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  setTimeout(() => t.classList.add('hidden'), duration);
}

function save() {
  DB.set('recipes', recipes);
  DB.set('mealPlan', mealPlan);
  DB.set('shoppingList', shoppingList);
}

// ==================== Navigation ====================
document.querySelectorAll('.nav-link').forEach(link => {
  link.addEventListener('click', e => {
    e.preventDefault();
    const page = link.dataset.page;
    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    link.classList.add('active');
    document.getElementById(`page-${page}`).classList.add('active');
    if (page === 'calendar') renderCalendar();
    if (page === 'recipes') renderRecipes();
    if (page === 'shopping') renderShoppingList();
  });
});

// ==================== Calendar ====================
const DAYS_JP = ['月', '火', '水', '木', '金', '土', '日'];
const MEALS = ['朝', '昼', '夜'];

function renderCalendar() {
  const grid = document.getElementById('calendar-grid');
  const label = document.getElementById('week-label');
  const end = new Date(currentWeekStart);
  end.setDate(end.getDate() + 6);
  label.textContent = `${formatDate(currentWeekStart)} 〜 ${formatDate(end)}`;

  grid.innerHTML = '';
  const dailyCalories = [];

  for (let i = 0; i < 7; i++) {
    const day = new Date(currentWeekStart);
    day.setDate(day.getDate() + i);
    const key = formatDate(day);
    const dayData = mealPlan[key] || {};

    let totalCal = 0;
    MEALS.forEach(m => {
      const meal = dayData[m];
      if (meal) {
        const r = recipes.find(r => r.id === meal.recipeId);
        if (r && r.calories) totalCal += Number(r.calories);
      }
    });
    dailyCalories.push({ label: DAYS_JP[i], cal: totalCal });

    const col = document.createElement('div');
    col.className = 'calendar-day';
    col.innerHTML = `
      <div class="day-header ${isToday(day) ? 'today' : ''}">
        <div>${DAYS_JP[i]}</div>
        <div class="date-num">${day.getDate()}</div>
      </div>
      <div class="meal-slots">
        ${MEALS.map(meal => {
          const m = dayData[meal];
          const r = m ? recipes.find(r => r.id === m.recipeId) : null;
          return `<div class="meal-slot ${r ? 'filled' : ''}" data-date="${key}" data-meal="${meal}">
            <div class="slot-label">${meal}</div>
            ${r
              ? `<div class="slot-name">${r.name}</div><div class="slot-cal">${r.calories ? r.calories+'kcal' : ''}</div>`
              : `<div class="slot-empty">＋ 追加</div>`
            }
          </div>`;
        }).join('')}
      </div>
    `;
    grid.appendChild(col);
  }

  // Calorie bars
  const maxCal = Math.max(...dailyCalories.map(d => d.cal), 2000);
  const barsEl = document.getElementById('weekly-calories');
  barsEl.innerHTML = dailyCalories.map(d => `
    <div class="calorie-bar-item">
      <div class="calorie-bar-label">${d.label}</div>
      <div class="calorie-bar-track">
        <div class="calorie-bar-fill" style="height:${d.cal ? Math.min((d.cal/maxCal)*100, 100) : 0}%"></div>
      </div>
      <div class="calorie-bar-value">${d.cal ? d.cal+'kcal' : '-'}</div>
    </div>
  `).join('');

  // Slot click
  grid.querySelectorAll('.meal-slot').forEach(slot => {
    slot.addEventListener('click', () => {
      pendingMealSlot = { date: slot.dataset.date, meal: slot.dataset.meal };
      openMealModal(slot.dataset.date, slot.dataset.meal);
    });
  });
}

document.getElementById('prev-week').addEventListener('click', () => {
  currentWeekStart.setDate(currentWeekStart.getDate() - 7);
  renderCalendar();
});

document.getElementById('next-week').addEventListener('click', () => {
  currentWeekStart.setDate(currentWeekStart.getDate() + 7);
  renderCalendar();
});

// ==================== Meal Modal ====================
function openMealModal(date, meal) {
  const modal = document.getElementById('meal-modal');
  document.getElementById('meal-modal-title').textContent = `${date} の${meal}食を選択`;
  renderMealRecipeList('');
  document.getElementById('meal-search').value = '';
  modal.classList.remove('hidden');
}

function renderMealRecipeList(query) {
  const list = document.getElementById('meal-recipe-list');
  const filtered = recipes.filter(r => r.name.includes(query));
  if (filtered.length === 0) {
    list.innerHTML = '<p style="color:var(--text-light);padding:16px">レシピがありません</p>';
    return;
  }
  list.innerHTML = filtered.map(r => `
    <div class="meal-recipe-item" data-id="${r.id}">
      <div class="meal-recipe-item-name">${r.name}</div>
      <div class="meal-recipe-item-info">${r.category} ${r.calories ? '・'+r.calories+'kcal' : ''} ${r.time ? '・'+r.time+'分' : ''}</div>
    </div>
  `).join('');

  list.querySelectorAll('.meal-recipe-item').forEach(item => {
    item.addEventListener('click', () => {
      if (!pendingMealSlot) return;
      const { date, meal } = pendingMealSlot;
      if (!mealPlan[date]) mealPlan[date] = {};
      mealPlan[date][meal] = { recipeId: item.dataset.id };
      save();
      renderCalendar();
      closeMealModal();
      showToast('献立を設定しました');
    });
  });
}

document.getElementById('meal-search').addEventListener('input', e => renderMealRecipeList(e.target.value));

document.getElementById('close-meal-modal').addEventListener('click', closeMealModal);
document.getElementById('cancel-meal-modal').addEventListener('click', closeMealModal);

document.getElementById('clear-meal').addEventListener('click', () => {
  if (!pendingMealSlot) return;
  const { date, meal } = pendingMealSlot;
  if (mealPlan[date]) delete mealPlan[date][meal];
  save();
  renderCalendar();
  closeMealModal();
  showToast('献立を削除しました');
});

function closeMealModal() {
  document.getElementById('meal-modal').classList.add('hidden');
  pendingMealSlot = null;
}

// ==================== Recipes ====================
function renderRecipes() {
  const query = document.getElementById('recipe-search').value;
  const cat = document.getElementById('category-filter').value;
  const list = document.getElementById('recipe-list');

  let filtered = recipes.filter(r => {
    const matchQ = r.name.includes(query) || (r.ingredients || '').includes(query);
    const matchC = !cat || r.category === cat;
    return matchQ && matchC;
  });

  if (filtered.length === 0) {
    list.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
      <div class="empty-icon">🍽️</div>
      <p>レシピがありません。「レシピを追加」から登録しましょう</p>
    </div>`;
    return;
  }

  list.innerHTML = filtered.map(r => `
    <div class="recipe-card">
      <div class="recipe-card-name">${r.name}</div>
      <div class="recipe-card-meta">
        <span class="recipe-tag">${r.category}</span>
      </div>
      <div class="recipe-card-info">
        ${r.calories ? `<span>🔥 ${r.calories}kcal</span>` : ''}
        ${r.time ? `<span>⏱ ${r.time}分</span>` : ''}
      </div>
      <div class="recipe-card-actions">
        <button class="btn btn-outline" style="font-size:0.8rem;padding:6px 12px" onclick="editRecipe('${r.id}')">編集</button>
        <button class="btn btn-danger" style="font-size:0.8rem;padding:6px 12px" onclick="deleteRecipe('${r.id}')">削除</button>
      </div>
    </div>
  `).join('');
}

document.getElementById('recipe-search').addEventListener('input', renderRecipes);
document.getElementById('category-filter').addEventListener('change', renderRecipes);

document.getElementById('add-recipe-btn').addEventListener('click', () => {
  editingRecipeId = null;
  document.getElementById('modal-title').textContent = 'レシピを追加';
  document.getElementById('recipe-form').reset();
  document.getElementById('recipe-modal').classList.remove('hidden');
});

document.getElementById('close-modal').addEventListener('click', () => {
  document.getElementById('recipe-modal').classList.add('hidden');
});
document.getElementById('cancel-modal').addEventListener('click', () => {
  document.getElementById('recipe-modal').classList.add('hidden');
});

document.getElementById('recipe-form').addEventListener('submit', e => {
  e.preventDefault();
  const recipe = {
    id: editingRecipeId || genId(),
    name: document.getElementById('recipe-name').value,
    category: document.getElementById('recipe-category').value,
    calories: document.getElementById('recipe-calories').value,
    time: document.getElementById('recipe-time').value,
    ingredients: document.getElementById('recipe-ingredients').value,
    steps: document.getElementById('recipe-steps').value,
    memo: document.getElementById('recipe-memo').value,
  };
  if (editingRecipeId) {
    recipes = recipes.map(r => r.id === editingRecipeId ? recipe : r);
    showToast('レシピを更新しました');
  } else {
    recipes.push(recipe);
    showToast('レシピを追加しました');
  }
  save();
  renderRecipes();
  document.getElementById('recipe-modal').classList.add('hidden');
});

window.editRecipe = (id) => {
  const r = recipes.find(r => r.id === id);
  if (!r) return;
  editingRecipeId = id;
  document.getElementById('modal-title').textContent = 'レシピを編集';
  document.getElementById('recipe-name').value = r.name;
  document.getElementById('recipe-category').value = r.category;
  document.getElementById('recipe-calories').value = r.calories || '';
  document.getElementById('recipe-time').value = r.time || '';
  document.getElementById('recipe-ingredients').value = r.ingredients || '';
  document.getElementById('recipe-steps').value = r.steps || '';
  document.getElementById('recipe-memo').value = r.memo || '';
  document.getElementById('recipe-modal').classList.remove('hidden');
};

window.deleteRecipe = (id) => {
  if (!confirm('このレシピを削除しますか？')) return;
  recipes = recipes.filter(r => r.id !== id);
  save();
  renderRecipes();
  showToast('レシピを削除しました');
};

// ==================== Shopping List ====================
function generateShoppingFromPlan() {
  const end = new Date(currentWeekStart);
  end.setDate(end.getDate() + 6);
  const ingredientMap = {};

  for (let i = 0; i < 7; i++) {
    const day = new Date(currentWeekStart);
    day.setDate(day.getDate() + i);
    const key = formatDate(day);
    const dayData = mealPlan[key] || {};
    MEALS.forEach(meal => {
      const m = dayData[meal];
      if (m) {
        const r = recipes.find(r => r.id === m.recipeId);
        if (r && r.ingredients) {
          r.ingredients.split('\n').forEach(line => {
            const trimmed = line.trim();
            if (trimmed) {
              if (!ingredientMap[trimmed]) ingredientMap[trimmed] = { name: trimmed, qty: '', unit: '', checked: false, id: genId() };
            }
          });
        }
      }
    });
  }

  const newItems = Object.values(ingredientMap);
  const existingNames = shoppingList.map(i => i.name);
  newItems.forEach(item => {
    if (!existingNames.includes(item.name)) shoppingList.push(item);
  });
  save();
  renderShoppingList();
  showToast(`買い物リストを生成しました（${newItems.length}品目）`);
}

function renderShoppingList() {
  const container = document.getElementById('shopping-list');
  if (shoppingList.length === 0) {
    container.innerHTML = `<div class="empty-state">
      <div class="empty-icon">🛒</div>
      <p>買い物リストが空です。献立から自動生成するか、手動で追加してください</p>
    </div>`;
    return;
  }

  const unchecked = shoppingList.filter(i => !i.checked);
  const checked = shoppingList.filter(i => i.checked);

  const renderItems = (items) => items.map(item => `
    <div class="shopping-item ${item.checked ? 'checked' : ''}" data-id="${item.id}">
      <input type="checkbox" ${item.checked ? 'checked' : ''} data-id="${item.id}">
      <span class="shopping-item-name">${item.name}</span>
      <span class="shopping-item-qty">${item.qty ? item.qty + (item.unit || '') : ''}</span>
      <button class="shopping-item-delete" data-id="${item.id}">✕</button>
    </div>
  `).join('');

  container.innerHTML = `
    <div class="shopping-category">
      <h3>未購入 (${unchecked.length})</h3>
      ${unchecked.length ? renderItems(unchecked) : '<p style="color:var(--text-light);font-size:0.85rem;padding:8px 4px">すべて購入済み 🎉</p>'}
    </div>
    ${checked.length ? `<div class="shopping-category">
      <h3>購入済み (${checked.length})</h3>
      ${renderItems(checked)}
    </div>` : ''}
  `;

  container.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => {
      const item = shoppingList.find(i => i.id === cb.dataset.id);
      if (item) { item.checked = cb.checked; save(); renderShoppingList(); }
    });
  });

  container.querySelectorAll('.shopping-item-delete').forEach(btn => {
    btn.addEventListener('click', () => {
      shoppingList = shoppingList.filter(i => i.id !== btn.dataset.id);
      save();
      renderShoppingList();
    });
  });
}

document.getElementById('generate-shopping').addEventListener('click', generateShoppingFromPlan);

document.getElementById('add-manual-item').addEventListener('click', () => {
  const name = document.getElementById('manual-item').value.trim();
  if (!name) return;
  shoppingList.push({
    id: genId(),
    name,
    qty: document.getElementById('manual-qty').value,
    unit: document.getElementById('manual-unit').value,
    checked: false,
  });
  save();
  renderShoppingList();
  document.getElementById('manual-item').value = '';
  document.getElementById('manual-qty').value = '';
  document.getElementById('manual-unit').value = '';
});

// ==================== AI Suggestions ====================
document.getElementById('ai-suggest-btn').addEventListener('click', async () => {
  const apiKey = DB.get('apiKey', '');
  if (!apiKey) {
    showToast('設定ページでAPIキーを入力してください');
    return;
  }

  const people = document.getElementById('ai-people').value;
  const budget = document.getElementById('ai-budget').value;
  const prefs = document.getElementById('ai-preferences').value;
  const calories = document.getElementById('ai-calories').value;

  const result = document.getElementById('ai-result');
  const loading = document.getElementById('ai-loading');
  const content = document.getElementById('ai-content');
  const applyBtn = document.getElementById('apply-ai-plan');

  result.classList.remove('hidden');
  loading.classList.remove('hidden');
  content.innerHTML = '';
  applyBtn.classList.add('hidden');

  const prompt = `日本の家庭向けに1週間分の献立を提案してください。

条件:
- 人数: ${people}人
- 週の予算: ${budget}円
- 好みや制限: ${prefs || 'なし'}
- 1日の目標カロリー: ${calories}kcal

以下の形式で出力してください:

【月曜日】
朝食: [料理名]（約XXXkcal）
昼食: [料理名]（約XXXkcal）
夕食: [料理名]（約XXXkcal）

【火曜日】
...（以下同様）

最後に「買い物のポイント」を3つ挙げてください。`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-allow-browser': 'true',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1500,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || 'APIエラー');

    const text = data.content[0].text;
    aiPlanData = text;

    content.innerHTML = `<div class="ai-content-box">${text}</div>`;
    applyBtn.classList.remove('hidden');
  } catch (err) {
    content.innerHTML = `<p style="color:var(--danger)">エラー: ${err.message}</p>`;
  } finally {
    loading.classList.add('hidden');
  }
});

document.getElementById('apply-ai-plan').addEventListener('click', () => {
  if (!aiPlanData) return;
  const days = ['月曜日', '火曜日', '水曜日', '木曜日', '金曜日', '土曜日', '日曜日'];
  const mealMap = { '朝食': '朝', '昼食': '昼', '夕食': '夜' };
  let added = 0;

  days.forEach((dayJp, i) => {
    const dayDate = new Date(currentWeekStart);
    dayDate.setDate(dayDate.getDate() + i);
    const key = formatDate(dayDate);

    ['朝食', '昼食', '夕食'].forEach(mealJp => {
      const regex = new RegExp(`${mealJp}:\\s*([^（\n]+)`);
      const match = aiPlanData.match(new RegExp(`【${dayJp}】[\\s\\S]*?${mealJp}:\\s*([^（\\n]+)`));
      if (match) {
        const mealName = match[1].trim();
        let r = recipes.find(r => r.name === mealName);
        if (!r) {
          const calMatch = aiPlanData.match(new RegExp(`${mealName}.*?（約(\\d+)kcal）`));
          r = { id: genId(), name: mealName, category: mealMap[mealJp] === '朝' ? '朝食' : mealMap[mealJp] === '昼' ? '昼食' : '夕食', calories: calMatch ? calMatch[1] : '', ingredients: '', steps: '', time: '', memo: 'AIが提案' };
          recipes.push(r);
        }
        if (!mealPlan[key]) mealPlan[key] = {};
        mealPlan[key][mealMap[mealJp]] = { recipeId: r.id };
        added++;
      }
    });
  });

  save();
  showToast(`${added}件の献立をカレンダーに追加しました`);
});

// ==================== Settings ====================
document.getElementById('save-api-key').addEventListener('click', () => {
  const key = document.getElementById('api-key-input').value.trim();
  DB.set('apiKey', key);
  showToast('APIキーを保存しました');
});

document.getElementById('clear-data').addEventListener('click', () => {
  if (!confirm('すべてのデータを削除しますか？この操作は取り消せません。')) return;
  localStorage.clear();
  recipes = [];
  mealPlan = {};
  shoppingList = [];
  renderCalendar();
  renderRecipes();
  renderShoppingList();
  showToast('データを削除しました');
});

// Load saved API key
const savedKey = DB.get('apiKey', '');
if (savedKey) document.getElementById('api-key-input').value = savedKey;

// ==================== Initial Render ====================
renderCalendar();
renderRecipes();
renderShoppingList();

// Add sample recipes if empty
if (recipes.length === 0) {
  const samples = [
    { id: genId(), name: '目玉焼きトースト', category: '朝食', calories: '350', time: '10', ingredients: '食パン 2枚\n卵 2個\nバター 適量\n塩胡椒 適量', steps: '1. トーストを焼く\n2. 目玉焼きを作る\n3. トーストに乗せる', memo: '' },
    { id: genId(), name: '親子丼', category: '昼食', calories: '650', time: '20', ingredients: '鶏もも肉 200g\n卵 3個\n玉ねぎ 1/2個\nだし 200ml\n醤油 大さじ2\nみりん 大さじ2\n砂糖 大さじ1\nご飯 2杯', steps: '1. 鶏肉を一口大に切る\n2. 玉ねぎを薄切りにする\n3. だし・調味料で煮る\n4. 卵でとじる', memo: '' },
    { id: genId(), name: '肉じゃが', category: '夕食', calories: '480', time: '35', ingredients: '牛肉 150g\nじゃがいも 3個\n玉ねぎ 1個\nにんじん 1本\nだし 300ml\n醤油 大さじ3\nみりん 大さじ3\n砂糖 大さじ2', steps: '1. 野菜を切る\n2. 牛肉を炒める\n3. 野菜を加えて炒める\n4. だし・調味料で煮込む', memo: '翌日はカレーにアレンジも◎' },
    { id: genId(), name: '味噌汁', category: '朝食', calories: '60', time: '10', ingredients: 'だし 400ml\n味噌 大さじ2\n豆腐 半丁\nわかめ 適量\nネギ 少々', steps: '1. だしを温める\n2. 具材を加える\n3. 味噌を溶く', memo: '' },
    { id: genId(), name: 'サラダうどん', category: '昼食', calories: '420', time: '15', ingredients: 'うどん 2玉\nレタス 3枚\nトマト 1個\nきゅうり 1本\nツナ缶 1缶\nめんつゆ 大さじ3\nごま油 少々', steps: '1. うどんを茹でて冷やす\n2. 野菜を切る\n3. 盛り付けてたれをかける', memo: '' },
  ];
  samples.forEach(s => recipes.push(s));
  save();
  renderRecipes();
}
