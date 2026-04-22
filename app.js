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
let goals = DB.get('goals', { carbs: 60, calories: 1600 });
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
  DB.set('goals', goals);
}

function carbLevel(carbs) {
  const g = Number(carbs);
  if (!g) return null;
  if (g <= 10) return 'low';
  if (g <= 30) return 'mid';
  return 'high';
}

function carbLabel(level) {
  return { low: '低糖質', mid: '中糖質', high: '高糖質' }[level] || '';
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
  const dailyData = [];

  for (let i = 0; i < 7; i++) {
    const day = new Date(currentWeekStart);
    day.setDate(day.getDate() + i);
    const key = formatDate(day);
    const dayData = mealPlan[key] || {};

    let totalCal = 0, totalCarb = 0;
    MEALS.forEach(m => {
      const meal = dayData[m];
      if (meal) {
        const r = recipes.find(r => r.id === meal.recipeId);
        if (r) {
          if (r.calories) totalCal += Number(r.calories);
          if (r.carbs) totalCarb += Number(r.carbs);
        }
      }
    });
    dailyData.push({ label: DAYS_JP[i], cal: totalCal, carb: totalCarb });

    const col = document.createElement('div');
    col.className = 'calendar-day';
    col.innerHTML = `
      <div class="day-header ${isToday(day) ? 'today' : ''}">
        <div>${DAYS_JP[i]}</div>
        <div class="date-num">${day.getDate()}</div>
      </div>
      ${totalCarb > 0 ? `<div class="day-carb-total">糖質 ${totalCarb.toFixed(1)}g${totalCarb > goals.carbs ? ' ⚠️' : ' ✓'}</div>` : ''}
      <div class="meal-slots">
        ${MEALS.map(meal => {
          const m = dayData[meal];
          const r = m ? recipes.find(r => r.id === m.recipeId) : null;
          const overCarb = r && r.carbs && Number(r.carbs) > goals.carbs / 3;
          return `<div class="meal-slot ${r ? 'filled' : ''} ${overCarb ? 'over-carb' : ''}" data-date="${key}" data-meal="${meal}">
            <div class="slot-label">${meal}</div>
            ${r
              ? `<div class="slot-name">${r.name}</div>
                 <div class="slot-info">
                   ${r.carbs ? `<span class="slot-carb">糖質${r.carbs}g</span>` : ''}
                   ${r.calories ? `<span class="slot-cal">${r.calories}kcal</span>` : ''}
                 </div>`
              : `<div class="slot-empty">＋ 追加</div>`
            }
          </div>`;
        }).join('')}
      </div>
    `;
    grid.appendChild(col);
  }

  // Calorie bars
  const maxCal = Math.max(...dailyData.map(d => d.cal), goals.calories);
  document.getElementById('weekly-calories').innerHTML = dailyData.map(d => `
    <div class="calorie-bar-item">
      <div class="calorie-bar-label">${d.label}</div>
      <div class="calorie-bar-track">
        <div class="calorie-bar-fill ${d.cal > goals.calories ? 'over' : ''}" style="height:${d.cal ? Math.min((d.cal/maxCal)*100, 100) : 0}%"></div>
      </div>
      <div class="calorie-bar-value">${d.cal ? d.cal+'kcal' : '-'}</div>
    </div>
  `).join('');

  // Carb bars
  const maxCarb = Math.max(...dailyData.map(d => d.carb), goals.carbs);
  document.getElementById('weekly-carbs').innerHTML = dailyData.map(d => `
    <div class="calorie-bar-item">
      <div class="calorie-bar-label">${d.label}</div>
      <div class="calorie-bar-track">
        <div class="calorie-bar-fill ${d.carb > goals.carbs ? 'over' : ''}" style="height:${d.carb ? Math.min((d.carb/maxCarb)*100, 100) : 0}%"></div>
      </div>
      <div class="calorie-bar-value">${d.carb ? d.carb.toFixed(1)+'g' : '-'}</div>
    </div>
  `).join('');

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
  const sorted = [...recipes]
    .filter(r => r.name.includes(query))
    .sort((a, b) => Number(a.carbs || 999) - Number(b.carbs || 999));

  if (sorted.length === 0) {
    list.innerHTML = '<p style="color:var(--text-light);padding:16px">レシピがありません</p>';
    return;
  }
  list.innerHTML = sorted.map(r => {
    const level = carbLevel(r.carbs);
    return `<div class="meal-recipe-item" data-id="${r.id}">
      <div class="meal-recipe-item-name">${r.name}</div>
      <div class="meal-recipe-item-info">
        ${level ? `<span class="carb-badge ${level}">${carbLabel(level)}</span> ` : ''}
        ${r.carbs ? `糖質${r.carbs}g ` : ''}${r.calories ? `・${r.calories}kcal` : ''}
      </div>
    </div>`;
  }).join('');

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
  const carbFilter = document.getElementById('carb-filter').value;
  const list = document.getElementById('recipe-list');

  let filtered = recipes.filter(r => {
    const matchQ = r.name.includes(query) || (r.ingredients || '').includes(query);
    const matchC = !cat || r.category === cat;
    const level = carbLevel(r.carbs);
    const matchCarb = !carbFilter || level === carbFilter;
    return matchQ && matchC && matchCarb;
  }).sort((a, b) => Number(a.carbs || 999) - Number(b.carbs || 999));

  if (filtered.length === 0) {
    list.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
      <div class="empty-icon">🥗</div>
      <p>レシピがありません。「レシピを追加」から登録しましょう</p>
    </div>`;
    return;
  }

  list.innerHTML = filtered.map(r => {
    const level = carbLevel(r.carbs);
    return `<div class="recipe-card">
      <div class="recipe-card-name">${r.name}</div>
      <div class="recipe-card-meta">
        <span class="recipe-tag">${r.category}</span>
        ${level ? `<span class="carb-badge ${level}">${carbLabel(level)}</span>` : ''}
      </div>
      <div class="recipe-card-info">
        ${r.carbs ? `<span>🌾 糖質${r.carbs}g</span>` : ''}
        ${r.calories ? `<span>🔥 ${r.calories}kcal</span>` : ''}
        ${r.time ? `<span>⏱ ${r.time}分</span>` : ''}
      </div>
      <div class="recipe-card-actions">
        <button class="btn btn-outline" style="font-size:0.8rem;padding:6px 12px" onclick="editRecipe('${r.id}')">編集</button>
        <button class="btn btn-danger" style="font-size:0.8rem;padding:6px 12px" onclick="deleteRecipe('${r.id}')">削除</button>
      </div>
    </div>`;
  }).join('');
}

document.getElementById('recipe-search').addEventListener('input', renderRecipes);
document.getElementById('category-filter').addEventListener('change', renderRecipes);
document.getElementById('carb-filter').addEventListener('change', renderRecipes);

document.getElementById('add-recipe-btn').addEventListener('click', () => {
  editingRecipeId = null;
  document.getElementById('modal-title').textContent = 'レシピを追加';
  document.getElementById('recipe-form').reset();
  document.getElementById('recipe-modal').classList.remove('hidden');
});

document.getElementById('close-modal').addEventListener('click', () => document.getElementById('recipe-modal').classList.add('hidden'));
document.getElementById('cancel-modal').addEventListener('click', () => document.getElementById('recipe-modal').classList.add('hidden'));

document.getElementById('recipe-form').addEventListener('submit', e => {
  e.preventDefault();
  const recipe = {
    id: editingRecipeId || genId(),
    name: document.getElementById('recipe-name').value,
    category: document.getElementById('recipe-category').value,
    carbs: document.getElementById('recipe-carbs').value,
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
  document.getElementById('recipe-carbs').value = r.carbs || '';
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
            if (trimmed && !ingredientMap[trimmed])
              ingredientMap[trimmed] = { name: trimmed, qty: '', unit: '', checked: false, id: genId() };
          });
        }
      }
    });
  }
  const newItems = Object.values(ingredientMap);
  const existingNames = shoppingList.map(i => i.name);
  newItems.forEach(item => { if (!existingNames.includes(item.name)) shoppingList.push(item); });
  save();
  renderShoppingList();
  showToast(`買い物リストを生成しました（${newItems.length}品目）`);
}

function renderShoppingList() {
  const container = document.getElementById('shopping-list');
  if (shoppingList.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">🛒</div><p>買い物リストが空です</p></div>`;
    return;
  }
  const unchecked = shoppingList.filter(i => !i.checked);
  const checked = shoppingList.filter(i => i.checked);
  const renderItems = items => items.map(item => `
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
      ${unchecked.length ? renderItems(unchecked) : '<p style="color:var(--text-light);font-size:0.85rem;padding:8px">すべて購入済み 🎉</p>'}
    </div>
    ${checked.length ? `<div class="shopping-category"><h3>購入済み (${checked.length})</h3>${renderItems(checked)}</div>` : ''}
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
      save(); renderShoppingList();
    });
  });
}

document.getElementById('generate-shopping').addEventListener('click', generateShoppingFromPlan);

document.getElementById('add-manual-item').addEventListener('click', () => {
  const name = document.getElementById('manual-item').value.trim();
  if (!name) return;
  shoppingList.push({ id: genId(), name, qty: document.getElementById('manual-qty').value, unit: document.getElementById('manual-unit').value, checked: false });
  save(); renderShoppingList();
  document.getElementById('manual-item').value = '';
  document.getElementById('manual-qty').value = '';
  document.getElementById('manual-unit').value = '';
});

// ==================== AI Suggestions ====================
document.getElementById('ai-suggest-btn').addEventListener('click', async () => {
  const apiKey = DB.get('apiKey', '');
  if (!apiKey) { showToast('設定ページでAPIキーを入力してください'); return; }

  const people = document.getElementById('ai-people').value;
  const carbs = document.getElementById('ai-carbs').value;
  const calories = document.getElementById('ai-calories').value;
  const budget = document.getElementById('ai-budget').value;
  const prefs = document.getElementById('ai-preferences').value;

  const result = document.getElementById('ai-result');
  const loading = document.getElementById('ai-loading');
  const content = document.getElementById('ai-content');
  const applyBtn = document.getElementById('apply-ai-plan');

  result.classList.remove('hidden');
  loading.classList.remove('hidden');
  content.innerHTML = '';
  applyBtn.classList.add('hidden');

  const prompt = `糖質制限ダイエット中の方向けに、1週間分の献立を提案してください。

条件:
- 人数: ${people}人
- 1日の目標糖質量: ${carbs}g以下
- 1日の目標カロリー: ${calories}kcal
- 週の予算: ${budget}円
- 制限・好み: ${prefs || 'なし'}

ルール:
- 白米・パン・麺類は極力避ける（または糖質オフ版を使う）
- たんぱく質（肉・魚・卵・大豆）を中心に
- 野菜はたっぷり使う
- 各食事の糖質量を必ず記載する

以下の形式で出力してください:

【月曜日】
朝食: [料理名]（糖質XXg・約XXXkcal）
昼食: [料理名]（糖質XXg・約XXXkcal）
夕食: [料理名]（糖質XXg・約XXXkcal）
1日合計: 糖質XXg・XXXXkcal

【火曜日】
...（以下同様）

最後に「糖質制限のポイント」を3つ挙げてください。`;

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
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || 'APIエラー');
    aiPlanData = data.content[0].text;
    content.innerHTML = `<div class="ai-content-box">${aiPlanData}</div>`;
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
      const match = aiPlanData.match(new RegExp(`【${dayJp}】[\\s\\S]*?${mealJp}:\\s*([^（\\n]+)`));
      if (match) {
        const mealName = match[1].trim();
        let r = recipes.find(r => r.name === mealName);
        if (!r) {
          const carbMatch = aiPlanData.match(new RegExp(`${mealName}.*?糖質(\\d+(?:\\.\\d+)?)g`));
          const calMatch = aiPlanData.match(new RegExp(`${mealName}.*?約(\\d+)kcal`));
          r = {
            id: genId(), name: mealName,
            category: mealMap[mealJp] === '朝' ? '朝食' : mealMap[mealJp] === '昼' ? '昼食' : '夕食',
            carbs: carbMatch ? carbMatch[1] : '',
            calories: calMatch ? calMatch[1] : '',
            ingredients: '', steps: '', time: '', memo: 'AIが提案',
          };
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
document.getElementById('save-goals').addEventListener('click', () => {
  goals.carbs = Number(document.getElementById('goal-carbs').value) || 60;
  goals.calories = Number(document.getElementById('goal-calories').value) || 1600;
  save();
  showToast('目標を保存しました');
});

document.getElementById('save-api-key').addEventListener('click', () => {
  DB.set('apiKey', document.getElementById('api-key-input').value.trim());
  showToast('APIキーを保存しました');
});

document.getElementById('clear-data').addEventListener('click', () => {
  if (!confirm('すべてのデータを削除しますか？')) return;
  localStorage.clear();
  recipes = []; mealPlan = {}; shoppingList = {}; goals = { carbs: 60, calories: 1600 };
  renderCalendar(); renderRecipes(); renderShoppingList();
  showToast('データを削除しました');
});

// Load saved values
const savedKey = DB.get('apiKey', '');
if (savedKey) document.getElementById('api-key-input').value = savedKey;
document.getElementById('goal-carbs').value = goals.carbs;
document.getElementById('goal-calories').value = goals.calories;

// ==================== Sample Recipes (糖質制限) ====================
if (recipes.length === 0) {
  const samples = [
    { id: genId(), name: 'スクランブルエッグ＆アボカド', category: '朝食', carbs: '2', calories: '320', time: '10', ingredients: '卵 3個\nアボカド 1/2個\nバター 10g\n塩胡椒 適量\nレモン汁 少々', steps: '1. 卵を溶く\n2. バターで炒めてスクランブルエッグを作る\n3. アボカドを添える', memo: '低糖質・高たんぱく' },
    { id: genId(), name: '鶏むね肉のグリル', category: '昼食', carbs: '1', calories: '280', time: '20', ingredients: '鶏むね肉 200g\nオリーブオイル 大さじ1\nにんにく 1片\n塩胡椒 適量\nレモン 1/2個', steps: '1. 鶏肉を薄くそぐ\n2. 塩胡椒・にんにくで下味\n3. グリルパンで焼く', memo: '糖質ほぼゼロ・高たんぱく' },
    { id: genId(), name: 'ブロッコリーとサーモンのサラダ', category: '昼食', carbs: '5', calories: '350', time: '15', ingredients: 'サーモン（刺身用）150g\nブロッコリー 100g\nきゅうり 1本\nオリーブオイル 大さじ2\nレモン汁 大さじ1\n塩胡椒 適量', steps: '1. ブロッコリーを茹でる\n2. 野菜を切る\n3. ドレッシングで和える', memo: '低糖質・オメガ3豊富' },
    { id: genId(), name: '豚バラ大根', category: '夕食', carbs: '8', calories: '420', time: '30', ingredients: '豚バラ肉 200g\n大根 300g\nだし 200ml\n醤油 大さじ2\nみりん 大さじ1\n生姜 1片', steps: '1. 大根を切って下茹で\n2. 豚バラを炒める\n3. だし・調味料で煮込む', memo: '大根は低糖質食材' },
    { id: genId(), name: '豆腐ステーキ', category: '夕食', carbs: '3', calories: '200', time: '15', ingredients: '木綿豆腐 1丁\nごま油 大さじ1\n醤油 大さじ2\nみりん 大さじ1\nかつお節 適量\n万能ねぎ 少々', steps: '1. 豆腐の水切りをする\n2. ごま油で両面を焼く\n3. タレをかける', memo: '超低糖質・ヘルシー' },
    { id: genId(), name: 'ゆで卵', category: '朝食', carbs: '0.1', calories: '80', time: '12', ingredients: '卵 2個', steps: '1. 水から卵を入れる\n2. 12分茹でる\n3. 冷水で冷やす', memo: '完全栄養食・持ち運びOK' },
    { id: genId(), name: '鮭の塩焼き', category: '夕食', carbs: '0.1', calories: '200', time: '15', ingredients: '鮭 1切れ\n塩 適量\nすだち 1個', steps: '1. 鮭に塩を振る\n2. グリルで焼く\n3. すだちを添える', memo: '糖質ゼロに近い優秀食材' },
    { id: genId(), name: 'カリフラワーライス炒飯', category: '昼食', carbs: '7', calories: '300', time: '20', ingredients: 'カリフラワー 300g\n卵 2個\nベーコン 50g\nにんにく 1片\nごま油 大さじ1\n醤油 大さじ1\n塩胡椒 適量', steps: '1. カリフラワーをフードプロセッサーで米粒状に\n2. ベーコン・にんにくを炒める\n3. カリフラワーと卵を加えて炒める', memo: '白米の代わりに！糖質90%カット' },
    { id: genId(), name: 'サラダチキン', category: '昼食', carbs: '1', calories: '150', time: '5', ingredients: 'サラダチキン（市販）1個\nレタス 適量\nトマト 1/4個', steps: '1. サラダチキンを切る\n2. 野菜と盛り付ける', memo: '手軽・高たんぱく・低糖質' },
    { id: genId(), name: 'チーズオムレツ', category: '朝食', carbs: '1', calories: '280', time: '8', ingredients: '卵 3個\nチーズ 30g\nバター 10g\n塩胡椒 適量', steps: '1. 卵を溶く\n2. バターで薄焼きに\n3. チーズを包む', memo: '低糖質の定番朝食' },
  ];
  samples.forEach(s => recipes.push(s));
  save();
  renderRecipes();
}

// ==================== Initial Render ====================
renderCalendar();
renderRecipes();
renderShoppingList();
