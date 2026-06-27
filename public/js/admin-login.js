if (new URLSearchParams(window.location.search).get('error')) {
  document.getElementById('error-msg').classList.remove('hidden');
}
