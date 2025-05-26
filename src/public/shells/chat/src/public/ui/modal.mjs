export function openModal(contentSrc, contentType) {
    const modal = document.createElement('div');
    modal.classList.add('modal', 'modal-open');

    let modalContentElement;

    if (contentType === 'image') {
        modalContentElement = document.createElement('img');
        modalContentElement.src = contentSrc;
        modalContentElement.classList.add('modal-img'); // Or a generic class
    } else if (contentType === 'video') {
        modalContentElement = document.createElement('video');
        modalContentElement.src = contentSrc;
        modalContentElement.controls = true;
        modalContentElement.autoplay = true; // Optional
        modalContentElement.classList.add('modal-video'); // Or a generic class
        // Style the video element for the modal to ensure it's not too small or too large
        modalContentElement.style.maxWidth = '90vw';
        modalContentElement.style.maxHeight = '90vh';
        modalContentElement.style.display = 'block'; // Prevents extra space below video
        modalContentElement.style.margin = 'auto'; // Centers the video
    } else {
        console.error('Unsupported content type for modal:', contentType);
        return; // Don't open modal for unsupported types
    }

    modal.appendChild(modalContentElement);

    modal.addEventListener('click', (e) => {
        // Close only if the modal background (not the content itself) is clicked
        if (e.target === modal) {
            // If it's a video, pause it before removing the modal
            if (contentType === 'video' && modalContentElement) {
                modalContentElement.pause();
            }
            modal.remove();
        }
    });

    document.body.appendChild(modal);
}
