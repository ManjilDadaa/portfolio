const form = document.getElementById('studentos-deletion-form');
const status = document.getElementById('deletion-status');
const submitButton = document.getElementById('deletion-submit');

form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    status.textContent = '';

    if (!form.reportValidity()) return;

    const email = new FormData(form).get('email')?.toString().trim();
    if (!email || !window.supabaseService) {
        status.textContent = 'The request service is unavailable. Please try again later.';
        status.className = 'form-status error';
        return;
    }

    submitButton.disabled = true;
    submitButton.textContent = 'Submitting...';

    try {
        const result = await window.supabaseService.saveDeletionRequest(email);

        if (!result.success) throw result.error || new Error('Could not save the request.');

        form.reset();
        status.textContent = 'Your request was submitted. We will verify it using the StudentOS account email and follow up after review.';
        status.className = 'form-status success';
    } catch (error) {
        console.error('StudentOS account deletion request failed:', error);
        status.textContent = 'We could not submit your request. Please try again later.';
        status.className = 'form-status error';
    } finally {
        submitButton.disabled = false;
        submitButton.textContent = 'Submit deletion request';
    }
});
