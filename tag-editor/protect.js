// Comprehensive protection: right-click, drag, select, dev tools
(function() {
    'use strict';

    // Disable right-click context menu
    document.addEventListener('contextmenu', function(e) {
        e.preventDefault();
        return false;
    });

    // Disable text selection
    document.addEventListener('selectstart', function(e) {
        e.preventDefault();
        return false;
    });

    // Disable drag (images/links)
    document.addEventListener('dragstart', function(e) {
        e.preventDefault();
        return false;
    });

    // Disable dev shortcuts (F12, Ctrl+U, Ctrl+Shift+I, etc.)
    document.addEventListener('keydown', function(e) {
        // F12
        if (e.key === 'F12') {
            e.preventDefault();
            return false;
        }
        // Ctrl+Shift+I (inspect)
        if (e.ctrlKey && e.shiftKey && e.key === 'I') {
            e.preventDefault();
            return false;
        }
        // Ctrl+U (view source)
        if (e.ctrlKey && e.key === 'u') {
            e.preventDefault();
            return false;
        }
        // Ctrl+S (save)
        if (e.ctrlKey && e.key === 's') {
            e.preventDefault();
            return false;
        }
    }, true);

    // CSS for no-select (backup)
    document.documentElement.style.userSelect = 'none';
    document.documentElement.style.webkitUserSelect = 'none';
    document.documentElement.style.mozUserSelect = 'none';
    document.documentElement.style.msUserSelect = 'none';

})();