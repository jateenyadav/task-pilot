// 10 tasks on the local practice sites, each with an automatic success check.
// state = the page's sessionStorage at the end; answer = the agent's final answer.
const J = (s, k) => { try { return JSON.parse(s[k] || 'null'); } catch { return null; } };
const has = (answer, ...words) => words.every((w) => answer.toLowerCase().replace(/[,\s]/g, '').includes(String(w).toLowerCase().replace(/[,\s]/g, '')));

export const TASKS = [
  { id: 'todo', page: 'todo.html', task: 'Add three to-dos: milk, bread and eggs.', check: ({ state }) => JSON.stringify(J(state, 'todos')?.map((x) => x.toLowerCase())) === '["milk","bread","eggs"]' },
  { id: 'shop', page: 'shop.html', task: 'Find the cheapest electric kettle in this shop and add it to the cart.', check: ({ state }) => JSON.stringify(J(state, 'cart')) === '["Mini Electric Kettle 0.8L"]' },
  { id: 'form', page: 'form.html', task: "Fill in the feedback form with name Asha, rating 4 and the comment 'Great chai', then submit it.", check: ({ state }) => { const f = J(state, 'feedback'); return f?.name === 'Asha' && f?.rating === '4' && /great chai/i.test(f?.comment || ''); } },
  { id: 'table', page: 'table.html', task: 'What is the population of Pune in this table?', check: ({ answer }) => has(answer, '3124458') },
  { id: 'wiki', page: 'wiki/index.html', task: 'Open the Monsoon recipes page and tell me the first ingredient of the pakora.', check: ({ answer }) => /gram flour|besan/i.test(answer) },
  { id: 'settings', page: 'settings.html', task: 'Turn dark mode on and email notifications off, then save the settings.', check: ({ state }) => JSON.stringify(J(state, 'settings')) === '{"dark":true,"email":false}' },
  { id: 'books', page: 'books.html', task: "Find the price of the book 'The White Tiger'.", check: ({ answer }) => has(answer, '399') },
  { id: 'checkout', page: 'checkout.html', task: 'Choose Hyderabad as the city and Express delivery, then continue.', check: ({ state }) => JSON.stringify(J(state, 'delivery')) === '{"city":"Hyderabad","speed":"express"}' },
  { id: 'long', page: 'long.html', task: 'Find the secret code on this page.', check: ({ answer }) => /CHAI-4821/i.test(answer) },
  { id: 'reviews', page: 'product.html', task: 'Open the reviews of this product and tell me how many reviews have 5 stars.', check: ({ answer }) => /\b7\b|seven/i.test(answer) },
];
