document.addEventListener('DOMContentLoaded', () => {
    const submitForm = document.getElementById('submit-form');
    if (submitForm) {
        submitForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const url = submitForm.querySelector('#input-url').value;
            const status = document.getElementById('submit-status');
            status.textContent = 'Submitting...';
            const res = await fetch('/api/submit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url })
            });
            const data = await res.json();
            if (data.success) {
                status.textContent = 'Page submitted and tournaments parsed!';
                window.location.reload();
            } else {
                status.textContent = data.error || 'Error submitting page.';
            }
        });
    }

    document.querySelectorAll('form[action="/api/submit"]').forEach(form => {
        form.addEventListener('submit', async (e) => {
            if (form.id === 'submit-form') return; // handled above
            e.preventDefault();
            const url = form.querySelector('input[name="url"]').value;
            const res = await fetch('/api/submit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url })
            });
            const data = await res.json();
            if (data.success) {
                window.location.reload();
            } else {
                alert(data.error || 'Error resubmitting page.');
            }
        });
    });

    const filtersForm = document.getElementById('filters-form');
    if (filtersForm) {
        filtersForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const formData = new FormData(filtersForm);
            const include = [];
            const exclude = [];
            for (let [key, value] of formData.entries()) {
                if (key.startsWith('include_type_')) {
                    const idx = key.replace('include_type_', '');
                    const val = formData.get('include_value_' + idx);
                    if (val) include.push({ type: value, value: val });
                }
                if (key.startsWith('exclude_type_')) {
                    const idx = key.replace('exclude_type_', '');
                    const val = formData.get('exclude_value_' + idx);
                    if (val) exclude.push({ type: value, value: val });
                }
            }
            const tierId = document.querySelector('[name="tier_id"]')?.value || window.selectedTier;
            await fetch('/api/filters', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tier_id: tierId, filters: { include, exclude } })
            });
            window.location.reload();
        });
    }
});
