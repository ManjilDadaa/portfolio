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

        if (!result.success) {
            console.error('StudentOS deletion request was rejected:', result.error);
            const code = result.error?.code;
            const statusCode = result.error?.status;

            if (code === 'PGRST205' || statusCode === 404) {
                status.textContent = 'The request form is not configured yet. Please try again later.';
            } else if (statusCode === 401 || statusCode === 403) {
                status.textContent = 'The request service needs a database permission update. Please try again later.';
            } else {
                status.textContent = 'We could not save your request. Check your connection and try again.';
            }
            status.className = 'form-status error';
            return;
        }

        form.reset();
        status.textContent = 'Your request was submitted. We will verify it using the StudentOS account email and follow up after review.';
        status.className = 'form-status success';
    } catch (error) {
        console.error('StudentOS account deletion request failed:', error);
        status.textContent = 'Could not connect to the request service. Check your connection and try again.';
        status.className = 'form-status error';
    } finally {
        submitButton.disabled = false;
        submitButton.textContent = 'Submit deletion request';
    }
});
