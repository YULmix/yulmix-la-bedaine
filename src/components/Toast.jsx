const TOAST_STYLES = {
  success: 'bg-green-100 border-green-300 text-green-800',
  error: 'bg-red-100 border-red-300 text-red-800',
  warning: 'bg-yellow-100 border-yellow-300 text-yellow-800',
  info: 'bg-blue-100 border-blue-300 text-blue-800'
};

const ToastContainer = ({ toasts, onDismiss }) => (
  <div className="fixed top-4 right-4 z-50 space-y-2">
    {toasts.map(toast => (
      <div key={toast.id} className={`px-4 py-3 rounded-lg shadow-lg border ${TOAST_STYLES[toast.type] || TOAST_STYLES.info}`}>
        <div className="flex justify-between items-center">
          <span>{toast.message}</span>
          <button onClick={() => onDismiss(toast.id)} className="ml-4 text-gray-500 hover:text-gray-700">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
    ))}
  </div>
);

export default ToastContainer;
