/* ==========================================================================
   SMART LIBRARY MANAGEMENT SYSTEM - MAIN APPLICATION JS
   ========================================================================== */

const API_BASE = (window.location.protocol === 'http:' || window.location.protocol === 'https:') && !window.location.hostname.includes('github.io') && window.location.port === '8000'
    ? `${window.location.origin}/api`
    : 'http://127.0.0.1:8000/api';

// --- SMART READER RESOLVER HELPER ---
function findMatchingReader(inputStr, readersList = []) {
    if (!inputStr) return null;
    const list = (readersList && readersList.length > 0) ? readersList : (mockStore ? mockStore.readers : []);
    if (!list || list.length === 0) return null;
    
    const cleanInput = String(inputStr).trim().toLowerCase();
    
    // 1. Direct match on reader_code, full_name, email, or username
    let match = list.find(r =>
        (r.reader_code && r.reader_code.toLowerCase() === cleanInput) ||
        (r.full_name && r.full_name.toLowerCase() === cleanInput) ||
        (r.email && r.email.toLowerCase() === cleanInput) ||
        (r.username && r.username.toLowerCase() === cleanInput)
    );
    if (match) return match;

    // 2. Extract digits from input string (e.g. 'docgia005' -> 5, 'dg05' -> 5, 'docgia4' -> 4)
    const digits = cleanInput.replace(/\D/g, '');
    if (digits) {
        const numVal = parseInt(digits, 10);
        match = list.find(r => {
            if (r.id === numVal) return true;
            if (r.reader_code) {
                const codeDigits = r.reader_code.replace(/\D/g, '');
                if (codeDigits && parseInt(codeDigits, 10) === numVal) return true;
            }
            if (r.username) {
                const userDigits = r.username.replace(/\D/g, '');
                if (userDigits && parseInt(userDigits, 10) === numVal) return true;
            }
            return false;
        });
        if (match) return match;
    }

    return null;
}

// --- STATE MANAGEMENT ---
const state = {
    currentUser: JSON.parse(localStorage.getItem('lib_user')) || null,
    activeTab: 'books',
    viewMode: 'grid', // 'grid' or 'table'
    books: [],
    categories: [],
    readers: [],
    loans: [],
    reservations: [],
    users: [],
    charts: {
        topBooks: null,
        category: null
    }
};

// --- DOM INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
    initApp();
});

async function initApp() {
    // Auto-clean obsolete or duplicate mock cache if present
    try {
        ['lib_mock_readers', 'lib_mock_users'].forEach(key => {
            const val = localStorage.getItem(key);
            if (val && (val.includes('dg001') || val.includes('dg002') || val.includes('dg003') || val.includes('DG04') || val.includes('DG05') || val.includes('DG006') || val.includes('Trương Thị Hạnh') || val.includes('Hồng Ngọc'))) {
                localStorage.removeItem(key);
            }
        });

        // Filter out returned loans from localStorage so returned books disappear from list
        const cachedLoans = localStorage.getItem('lib_mock_loans');
        if (cachedLoans) {
            const parsed = JSON.parse(cachedLoans);
            const activeOnly = parsed.filter(l => l.status !== 'Đã trả');
            localStorage.setItem('lib_mock_loans', JSON.stringify(activeOnly));
        }
    } catch (e) {}

    setupEventListeners();
    try {
        await loadCategories();
    } catch (err) {
        console.warn("Backend server not reached during initialization:", err.message);
    }
    checkAuthState();
}

// --- MANDATORY LOGIN GATE & AUTH CHECK ---
function checkAuthState() {
    const loginOverlay = document.getElementById('loginOverlay');
    const appContainer = document.getElementById('app');

    if (!state.currentUser) {
        // Show Full Screen Login Gate
        loginOverlay.classList.remove('hidden');
        appContainer.classList.add('hidden');
    } else {
        // User logged in -> Hide login gate & Show App
        loginOverlay.classList.add('hidden');
        appContainer.classList.remove('hidden');

        updateUserUI();
        applyRoleAccess();
        
        // Select initial tab based on role
        if (state.currentUser.role === 'reader') {
            switchTab('books');
        } else {
            switchTab('dashboard');
        }
    }
}

function applyRoleAccess() {
    const role = state.currentUser ? state.currentUser.role : 'guest';

    // Update Book Nav Label
    const bookNavLabel = document.getElementById('bookNavLabel');
    if (bookNavLabel) {
        bookNavLabel.textContent = (role === 'reader') ? 'Tra cứu Sách' : 'Tra cứu & Quản lý Sách';
    }

    // Hide/Show navigation links and UI components based on role
    document.querySelectorAll('.role-staff-only').forEach(el => {
        el.style.display = (role === 'admin' || role === 'librarian') ? 'flex' : 'none';
    });

    document.querySelectorAll('.role-admin-only').forEach(el => {
        el.style.display = (role === 'admin') ? 'flex' : 'none';
    });

    document.querySelectorAll('.role-reader-only').forEach(el => {
        el.style.display = (role === 'reader') ? 'flex' : 'none';
    });

    document.querySelectorAll('.role-librarian-only').forEach(el => {
        el.style.display = (role === 'admin' || role === 'librarian') ? 'inline-flex' : 'none';
    });
}

function handleLogout() {
    localStorage.removeItem('lib_user');
    state.currentUser = null;
    showToast('Đã đăng xuất tài khoản thành công', 'info');
    
    // Reset overlay form inputs
    document.getElementById('overlayUsername').value = '';
    document.getElementById('overlayPassword').value = '';
    
    checkAuthState();
}

async function handleLoginSubmit(e) {
    e.preventDefault();
    const username = document.getElementById('overlayUsername').value.trim();
    const password = document.getElementById('overlayPassword').value.trim();

    if (!username || !password) {
        showToast('Vui lòng nhập tên đăng nhập và mật khẩu', 'warning');
        return;
    }

    try {
        const res = await fetchAPI('/auth/login', 'POST', { username, password });
        state.currentUser = res.user;
        localStorage.setItem('lib_user', JSON.stringify(res.user));
        showToast(`Xin chào ${res.user.full_name} (${(res.user.role || 'user').toUpperCase()})!`, 'success');
        checkAuthState();
    } catch (err) {
        // Universal Fallback for Static Hosting / Offline Server
        const userLower = username.toLowerCase();
        const role = userLower.includes('admin') ? 'admin' : (userLower.includes('thu') ? 'librarian' : 'reader');
        const roleTitle = role === 'admin' ? 'Quản trị viên' : (role === 'librarian' ? 'Thủ thư' : 'Độc giả');
        
        const matchedReader = role === 'reader' ? findMatchingReader(username, mockStore.readers) : null;

        let readerId = matchedReader ? matchedReader.id : null;
        let readerCode = matchedReader ? matchedReader.reader_code : null;
        let fullName = matchedReader ? matchedReader.full_name : `${username} (${roleTitle})`;
        let email = matchedReader ? matchedReader.email : `${username}@library.edu.vn`;
        let phone = matchedReader ? matchedReader.phone : '0901234567';
        let cardStatus = matchedReader ? matchedReader.status : (role === 'reader' ? 'Hoạt động' : 'N/A');
        let cardType = matchedReader ? matchedReader.card_type : 'Sinh viên';
        let expiryDate = matchedReader ? matchedReader.expiry_date : '2027-09-01';

        if (role === 'reader' && !matchedReader) {
            const newId = Date.now();
            const digits = userLower.replace(/\D/g, '');
            readerCode = digits ? `DG${digits.padStart(2, '0')}` : `DG00${(mockStore.readers || []).length + 1}`;
            readerId = newId;
            fullName = username;
            cardStatus = 'Hoạt động';

            const newReader = {
                id: newId,
                reader_code: readerCode,
                full_name: fullName,
                email: email,
                phone: phone,
                card_type: cardType,
                status: cardStatus,
                issue_date: '2025-09-01',
                expiry_date: expiryDate
            };
            if (!mockStore.readers) mockStore.readers = [];
            mockStore.readers.push(newReader);
            saveMockStore();
        }

        state.currentUser = {
            id: readerId || Math.floor(Math.random() * 1000) + 10,
            username: username,
            role: role,
            full_name: fullName,
            email: email,
            phone: phone,
            reader_id: readerId,
            reader_code: readerCode,
            card_status: cardStatus,
            card_type: cardType,
            expiry_date: expiryDate,
            created_at: '2025-09-01'
        };
        localStorage.setItem('lib_user', JSON.stringify(state.currentUser));
        showToast(`[Demo Mode] Xin chào ${state.currentUser.full_name}!`, 'success');
        checkAuthState();
    }
}

function getInitialBooks() {
    const defaultBooks = [
        { id: 1, book_code: 'MS001', title: 'Nhập Môn Lập Trình Python', author: 'Guido van Rossum', category_id: 1, category_name: 'Công nghệ Thông tin & AI', publisher: 'NXB Bách Khoa', publish_year: 2023, total_qty: 5, available_qty: 3, rack_location: 'Kệ A1-01', description: 'Cuốn sách căn bản dành cho người mới bắt đầu học lập trình Python. Hướng dẫn chi tiết cú pháp, cấu trúc dữ liệu, hàm và lập trình hướng đối tượng với nhiều ví dụ thực tế.', cover_url: 'https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?w=400&q=80' },
        { id: 2, book_code: 'MS002', title: 'Trí Tuệ Nhân Tạo & Deep Learning', author: 'Andrew Ng', category_id: 1, category_name: 'Công nghệ Thông tin & AI', publisher: 'NXB Tri Thức', publish_year: 2024, total_qty: 4, available_qty: 2, rack_location: 'Kệ A1-02', description: 'Kiến thức chuyên sâu về Mạng nơ-ron nhân tạo (Neural Networks), Học sâu (Deep Learning) và AI tạo sinh.', cover_url: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=400&q=80' },
        { id: 3, book_code: 'MS003', title: 'Đắc Nhân Tâm', author: 'Dale Carnegie', category_id: 6, category_name: 'Kỹ năng sống & Phát triển', publisher: 'NXB Trẻ', publish_year: 2022, total_qty: 10, available_qty: 7, rack_location: 'Kệ F2-05', description: 'Nghệ thuật thu phục lòng người và giao tiếp ứng xử thành công.', cover_url: 'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=400&q=80' },
        { id: 4, book_code: 'MS004', title: 'Nhà Giả Kim (The Alchemist)', author: 'Paulo Coelho', category_id: 2, category_name: 'Văn học & Nghệ thuật', publisher: 'NXB Nhã Nam', publish_year: 2023, total_qty: 8, available_qty: 4, rack_location: 'Kệ B1-04', description: 'Hành trình theo đuổi vận mệnh và giấc mơ của chàng chăn cừu Santiago.', cover_url: 'https://images.unsplash.com/photo-1543002588-bfa74002ed7e?w=400&q=80' },
        { id: 5, book_code: 'MS005', title: 'Kinh Tế Học Vĩ Mô & Quản Trị', author: 'N. Gregory Mankiw', category_id: 3, category_name: 'Kinh tế & Quản trị', publisher: 'NXB Thống Kê', publish_year: 2023, total_qty: 6, available_qty: 5, rack_location: 'Kệ C2-01', description: 'Giáo trình chuẩn quốc tế về các nguyên lý kinh tế học vĩ mô và quản trị doanh nghiệp.', cover_url: 'https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?w=400&q=80' },
        { id: 6, book_code: 'MS006', title: 'Clean Code - Mã Sạch và Nghệ Thuật Lập Trình', author: 'Robert C. Martin (Uncle Bob)', category_id: 1, category_name: 'Công nghệ Thông tin & AI', publisher: 'NXB Lao Động', publish_year: 2023, total_qty: 6, available_qty: 5, rack_location: 'Kệ A1-03', description: 'Cuốn sách gối đầu giường về nguyên lý lập trình sạch, refactoring và viết mã dễ bảo trì cho lập trình viên.', cover_url: 'https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=400&q=80' },
        { id: 7, book_code: 'MS007', title: 'Sapiens - Lược Sử Loài Người', author: 'Yuval Noah Harari', category_id: 5, category_name: 'Lịch sử & Triết học', publisher: 'NXB Tri Thức', publish_year: 2022, total_qty: 9, available_qty: 6, rack_location: 'Kệ E1-08', description: 'Hành trình tiến hóa của loài Homo Sapiens từ thời kỳ đồ đá cho đến kỷ nguyên công nghệ hiện đại.', cover_url: 'https://images.unsplash.com/photo-1461360370896-922624d12aa1?w=400&q=80' },
        { id: 8, book_code: 'MS008', title: 'Tuần Làm Việc 4 Giờ', author: 'Timothy Ferriss', category_id: 6, category_name: 'Kỹ năng sống & Phát triển', publisher: 'NXB Thế Giới', publish_year: 2022, total_qty: 8, available_qty: 6, rack_location: 'Kệ B2-08', description: 'Bí quyết thoát khỏi nhịp sống văn phòng rập khuôn, tối ưu hóa hiệu suất công việc và tự do tài chính.', cover_url: 'https://images.unsplash.com/photo-1507679799987-c73779587ccf?w=400&q=80' },
        { id: 9, book_code: 'MS009', title: 'Chiến Lược Đại Dương Xanh', author: 'W. Chan Kim & Renée Mauborgne', category_id: 3, category_name: 'Kinh tế & Quản trị', publisher: 'NXB Tri Thức', publish_year: 2023, total_qty: 7, available_qty: 4, rack_location: 'Kệ D3-05', description: 'Phương pháp tạo dựng khoảng trống thị trường không cạnh tranh và biến cạnh tranh thành vô hiệu.', cover_url: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=400&q=80' },
        { id: 10, book_code: 'MS010', title: 'Vũ Trụ Trong Vỏ Hạt Dẻ', author: 'Stephen Hawking', category_id: 4, category_name: 'Khoa học & Kỹ thuật', publisher: 'NXB Khoa Học Kỹ Thuật', publish_year: 2023, total_qty: 5, available_qty: 4, rack_location: 'Kệ D1-03', description: 'Giải thích các bí ẩn vũ trụ, hố đen, lý thuyết tương đối và cơ học lượng tử một cách cuốn hút.', cover_url: 'https://images.unsplash.com/photo-1507668077129-56e32842fceb?w=400&q=80' },
        { id: 11, book_code: 'MS011', title: 'Tư Duy Nhanh Và Chậm', author: 'Daniel Kahneman', category_id: 6, category_name: 'Kỹ năng sống & Phát triển', publisher: 'NXB Thế Giới', publish_year: 2023, total_qty: 8, available_qty: 5, rack_location: 'Kệ F1-02', description: 'Khám phá hai hệ thống tư duy chi phối mọi quyết định và hành vi con người của nhà kinh tế học đoạt giải Nobel.', cover_url: 'https://images.unsplash.com/photo-1499750310107-5fef28a66643?w=400&q=80' },
        { id: 12, book_code: 'MS012', title: 'Hệ Thống Thiết Kế Design Systems', author: 'Alla Kholmatova', category_id: 1, category_name: 'Công nghệ Thông tin & AI', publisher: 'NXB Bách Khoa', publish_year: 2024, total_qty: 6, available_qty: 4, rack_location: 'Kệ A1-08', description: 'Hướng dẫn xây dựng hệ thống thiết kế giao diện UI/UX đồng bộ, linh hoạt và chuẩn hóa cho sản phẩm số.', cover_url: 'https://images.unsplash.com/photo-1507238691740-187a5b1d37b8?w=400&q=80' },
        { id: 13, book_code: 'MS013', title: 'Dế Mèn Phiêu Lưu Ký', author: 'Tô Hoài', category_id: 2, category_name: 'Văn học & Nghệ thuật', publisher: 'NXB Kim Đồng', publish_year: 2021, total_qty: 6, available_qty: 4, rack_location: 'Kệ B3-12', description: 'Tác phẩm văn học thiếu nhi kinh điển của nhà văn Tô Hoài, kể về cuộc phiêu lưu tự do và bài học nhân văn.', cover_url: 'https://images.unsplash.com/photo-1512820790803-83ca734da794?w=400&q=80' },
        { id: 14, book_code: 'MS014', title: 'Rừng Na-uy', author: 'Haruki Murakami', category_id: 2, category_name: 'Văn học & Nghệ thuật', publisher: 'NXB Hội Nhà Văn', publish_year: 2022, total_qty: 7, available_qty: 5, rack_location: 'Kệ C1-08', description: 'Tiểu thuyết lừng danh về tuổi trẻ, tình yêu, sự cô đơn và những trăn trở của thanh xuân thế hệ 1960.', cover_url: 'https://images.unsplash.com/photo-1474939557548-f842486be195?w=400&q=80' },
        { id: 15, book_code: 'MS015', title: 'Khéo Ăn Khéo Nói Sẽ Có Được Cả Thiên Hạ', author: 'Trác Nhã', category_id: 6, category_name: 'Kỹ năng sống & Phát triển', publisher: 'NXB Văn Học', publish_year: 2023, total_qty: 10, available_qty: 8, rack_location: 'Kệ B2-12', description: 'Nghệ thuật ứng xử, đàm phán và giao tiếp tinh tế trong công việc, cuộc sống giúp bạn thành công hơn.', cover_url: 'https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=400&q=80' }
    ];

    const savedStr = localStorage.getItem('lib_mock_books');
    if (!savedStr) return defaultBooks;
    try {
        const saved = JSON.parse(savedStr);
        defaultBooks.forEach(defB => {
            if (!saved.some(b => b.book_code === defB.book_code)) {
                saved.push(defB);
            }
        });
        return saved;
    } catch (e) {
        return defaultBooks;
    }
}

// --- MOCK DATA STORE FOR STATIC HOSTING / DEMO MODE ---
const mockStore = {
    books: getInitialBooks(),
    readers: JSON.parse(localStorage.getItem('lib_mock_readers')) || [
        { id: 1, reader_code: 'DG001', full_name: 'Nguyễn Văn An', email: 'an.nguyen@email.com', phone: '0901234567', card_type: 'Sinh viên', status: 'Hoạt động', issue_date: '2025-09-01', expiry_date: '2027-09-01' },
        { id: 2, reader_code: 'DG002', full_name: 'Trần Thị Bình', email: 'binh.tran@email.com', phone: '0912345678', card_type: 'Sinh viên', status: 'Hoạt động', issue_date: '2025-09-01', expiry_date: '2027-09-01' },
        { id: 3, reader_code: 'DG003', full_name: 'Lê Hoàng Cường', email: 'cuong.le@email.com', phone: '0923456789', card_type: 'Giảng viên', status: 'Hoạt động', issue_date: '2024-01-15', expiry_date: '2028-01-15' }
    ],
    loans: JSON.parse(localStorage.getItem('lib_mock_loans')) || [
        { id: 1, borrow_code: 'PM001', reader_id: 1, reader_name: 'Nguyễn Văn An', reader_code: 'DG001', book_id: 1, book_title: 'Nhập Môn Lập Trình Python', book_code: 'MS001', borrow_date: '2026-03-01', due_date: '2026-03-15', return_date: null, status: 'Đang mượn', fine_amount: 0, fine_status: 'N/A' },
        { id: 2, borrow_code: 'PM002', reader_id: 2, reader_name: 'Trần Thị Bình', reader_code: 'DG002', book_id: 2, book_title: 'Trí Tuệ Nhân Tạo & Deep Learning', book_code: 'MS002', borrow_date: '2026-02-10', due_date: '2026-02-24', return_date: null, status: 'Quá hạn', fine_amount: 85000, fine_status: 'Chưa nộp' },
        { id: 3, borrow_code: 'PM003', reader_id: 3, reader_name: 'Lê Hoàng Cường', reader_code: 'DG003', book_id: 3, book_title: 'Đắc Nhân Tâm', book_code: 'MS003', borrow_date: '2026-01-05', due_date: '2026-01-19', return_date: '2026-01-18', status: 'Đã trả', fine_amount: 0, fine_status: 'N/A' }
    ],
    users: JSON.parse(localStorage.getItem('lib_mock_users')) || [
        { id: 1, username: 'admin', role: 'admin', full_name: 'Quản trị viên Hệ thống', email: 'admin@library.edu.vn', created_at: '2025-01-01' },
        { id: 2, username: 'thuthu1', role: 'librarian', full_name: 'Thủ thư Nguyễn Thị Mai', email: 'mai.thuthu@library.edu.vn', created_at: '2025-01-05' },
        { id: 3, username: 'docgia1', role: 'reader', full_name: 'Nguyễn Văn An', email: 'an.nguyen@email.com', reader_id: 1, reader_code: 'DG001', created_at: '2025-09-01' },
        { id: 4, username: 'docgia2', role: 'reader', full_name: 'Trần Thị Bình', email: 'binh.tran@email.com', reader_id: 2, reader_code: 'DG002', created_at: '2025-09-01' },
        { id: 5, username: 'docgia3', role: 'reader', full_name: 'Lê Hoàng Cường', email: 'cuong.le@email.com', reader_id: 3, reader_code: 'DG003', created_at: '2025-09-01' }
    ]
};

function saveMockStore() {
    try {
        localStorage.setItem('lib_mock_books', JSON.stringify(mockStore.books));
        localStorage.setItem('lib_mock_readers', JSON.stringify(mockStore.readers));
        localStorage.setItem('lib_mock_loans', JSON.stringify(mockStore.loans));
        localStorage.setItem('lib_mock_users', JSON.stringify(mockStore.users));
    } catch (e) {}
}

function getMockData(endpoint, method = 'GET', data = null) {
    // Auth Login
    if (endpoint === '/auth/login' && method === 'POST') {
        const username = (data && data.username) ? data.username.trim().toLowerCase() : 'user';

        const demoUsers = {
            'admin': { id: 1, username: 'admin', role: 'admin', full_name: 'Quản trị viên Hệ thống', email: 'admin@library.edu.vn' },
            'thuthu1': { id: 2, username: 'thuthu1', role: 'librarian', full_name: 'Thủ thư Nguyễn Thị Mai', email: 'mai.thuthu@library.edu.vn' },
            'docgia1': { id: 3, username: 'docgia1', role: 'reader', full_name: 'Nguyễn Văn An', email: 'an.nguyen@email.com', reader_id: 1, reader_code: 'DG001' },
            'dg001': { id: 3, username: 'dg001', role: 'reader', full_name: 'Nguyễn Văn An', email: 'an.nguyen@email.com', reader_id: 1, reader_code: 'DG001' },
            'docgia2': { id: 4, username: 'docgia2', role: 'reader', full_name: 'Trần Thị Bình', email: 'binh.tran@email.com', reader_id: 2, reader_code: 'DG002' },
            'dg002': { id: 4, username: 'dg002', role: 'reader', full_name: 'Trần Thị Bình', email: 'binh.tran@email.com', reader_id: 2, reader_code: 'DG002' },
            'docgia3': { id: 5, username: 'docgia3', role: 'reader', full_name: 'Lê Hoàng Cường', email: 'cuong.le@email.com', reader_id: 3, reader_code: 'DG003' },
            'dg003': { id: 5, username: 'dg003', role: 'reader', full_name: 'Lê Hoàng Cường', email: 'cuong.le@email.com', reader_id: 3, reader_code: 'DG003' }
        };

        if (demoUsers[username]) {
            return { user: demoUsers[username], message: 'Đăng nhập thành công (Demo Mode)' };
        }

        const foundUser = mockStore.users.find(u => u.username.toLowerCase() === username);
        if (foundUser) {
            return { user: foundUser, message: 'Đăng nhập thành công (Demo Mode)' };
        }

        const matchingReader = findMatchingReader(username, mockStore.readers);

        const role = username.includes('admin') ? 'admin' : (username.includes('thu') ? 'librarian' : 'reader');
        const roleTitle = role === 'admin' ? 'Quản trị viên' : (role === 'librarian' ? 'Thủ thư' : 'Độc giả');

        let userObj = {
            id: matchingReader ? matchingReader.id : (Math.floor(Math.random() * 1000) + 10),
            username: username,
            role: role,
            full_name: matchingReader ? matchingReader.full_name : `${username} (${roleTitle})`,
            email: matchingReader ? matchingReader.email : `${username}@library.edu.vn`,
            phone: matchingReader ? matchingReader.phone : '0901234567',
            reader_id: matchingReader ? matchingReader.id : null,
            reader_code: matchingReader ? matchingReader.reader_code : null,
            card_status: matchingReader ? matchingReader.status : (role === 'reader' ? 'Hoạt động' : 'N/A'),
            card_type: matchingReader ? matchingReader.card_type : 'Sinh viên',
            issue_date: matchingReader ? matchingReader.issue_date : '2025-09-01',
            expiry_date: matchingReader ? matchingReader.expiry_date : '2027-09-01',
            created_at: matchingReader ? matchingReader.issue_date : '2025-09-01'
        };

        if (role === 'reader' && !matchingReader) {
            const newId = Date.now();
            const digits = username.replace(/\D/g, '');
            const newCode = digits ? `DG${digits.padStart(2, '0')}` : `DG${mockStore.readers.length + 1}`;
            const newReader = {
                id: newId,
                reader_code: newCode,
                full_name: username,
                email: `${username}@library.edu.vn`,
                phone: '0901234567',
                card_type: 'Sinh viên',
                status: 'Hoạt động',
                issue_date: '2025-09-01',
                expiry_date: '2027-09-01'
            };
            mockStore.readers.push(newReader);
            saveMockStore();

            userObj.id = newId;
            userObj.reader_id = newId;
            userObj.reader_code = newCode;
            userObj.full_name = username;
            userObj.card_status = 'Hoạt động';
        }

        return {
            user: userObj,
            message: 'Đăng nhập thành công (Demo Mode)'
        };
    }

    // Categories
    if (endpoint.startsWith('/categories')) {
        return [
            { id: 1, code: 'CNTT', name: 'Công nghệ Thông tin & AI', description: 'Lập trình, AI, Data' },
            { id: 2, code: 'VH', name: 'Văn học & Nghệ thuật', description: 'Tiểu thuyết, truyện ngắn' },
            { id: 3, code: 'KT', name: 'Kinh tế & Quản trị', description: 'Kinh doanh, Tài chính' },
            { id: 4, code: 'KH', name: 'Khoa học & Kỹ thuật', description: 'Vật lý, Toán học' },
            { id: 5, code: 'LS', name: 'Lịch sử & Triết học', description: 'Lịch sử thế giới & VN' },
            { id: 6, code: 'KNS', name: 'Kỹ năng sống & Phát triển', description: 'Phát triển bản thân' }
        ];
    }

    // Dashboard Stats
    if (endpoint.startsWith('/stats/dashboard')) {
        const availCopies = mockStore.books.reduce((acc, b) => acc + (b.available_qty || 0), 0);
        return {
            book_stats: { total_books: mockStore.books.length * 10, available_copies: availCopies },
            reader_stats: { total_readers: mockStore.readers.length, active_readers: mockStore.readers.filter(r => r.status === 'Hoạt động').length },
            loan_stats: { active_loans: mockStore.loans.filter(l => l.status === 'Đang mượn').length, overdue_loans: mockStore.loans.filter(l => l.status === 'Quá hạn').length, total_fines: 120000 },
            top_books: mockStore.books.map(b => ({ id: b.id, title: b.title, borrow_count: 15 })),
            category_stats: [
                { category_name: 'Công nghệ Thông tin & AI', total_copies: 45 },
                { category_name: 'Văn học & Nghệ thuật', total_copies: 35 },
                { category_name: 'Kinh tế & Quản trị', total_copies: 30 }
            ]
        };
    }

    // --- BOOKS ---
    if (endpoint.startsWith('/books')) {
        if (method === 'POST') {
            const categoriesList = [
                { id: 1, name: 'Công nghệ Thông tin & AI' },
                { id: 2, name: 'Văn học & Nghệ thuật' },
                { id: 3, name: 'Kinh tế & Quản trị' },
                { id: 4, name: 'Khoa học & Kỹ thuật' },
                { id: 5, name: 'Lịch sử & Triết học' },
                { id: 6, name: 'Kỹ năng sống & Phát triển' }
            ];
            const cat = categoriesList.find(c => c.id == data.category_id);

            const newBook = {
                id: Date.now(),
                ...data,
                category_name: cat ? cat.name : 'Khác'
            };
            mockStore.books.unshift(newBook);
            saveMockStore();
            return { message: 'Thêm sách mới thành công! (Demo Mode)', id: newBook.id };
        }

        if (method === 'PUT') {
            const bookId = parseInt(endpoint.split('/')[2]);
            const idx = mockStore.books.findIndex(b => b.id == bookId);
            if (idx !== -1) {
                const categoriesList = [
                    { id: 1, name: 'Công nghệ Thông tin & AI' },
                    { id: 2, name: 'Văn học & Nghệ thuật' },
                    { id: 3, name: 'Kinh tế & Quản trị' },
                    { id: 4, name: 'Khoa học & Kỹ thuật' },
                    { id: 5, name: 'Lịch sử & Triết học' },
                    { id: 6, name: 'Kỹ năng sống & Phát triển' }
                ];
                const cat = categoriesList.find(c => c.id == data.category_id);

                mockStore.books[idx] = {
                    ...mockStore.books[idx],
                    ...data,
                    category_name: cat ? cat.name : mockStore.books[idx].category_name
                };
                saveMockStore();
            }
            return { message: 'Cập nhật thông tin sách thành công! (Demo Mode)' };
        }

        if (method === 'DELETE') {
            const bookId = parseInt(endpoint.split('/')[2]);
            mockStore.books = mockStore.books.filter(b => b.id != bookId);
            saveMockStore();
            return { message: 'Đã xóa sách khỏi thư viện (Demo Mode)' };
        }

        return mockStore.books;
    }

    // --- READERS ---
    if (endpoint.startsWith('/readers')) {
        if (method === 'POST') {
            const todayStr = new Date().toISOString().split('T')[0];
            const expDate = new Date(Date.now() + 730*24*60*60*1000).toISOString().split('T')[0];
            const newReader = {
                id: Date.now(),
                ...data,
                issue_date: todayStr,
                expiry_date: expDate
            };
            mockStore.readers.unshift(newReader);
            
            // Auto create reader user account
            mockStore.users.unshift({
                id: Date.now() + 1,
                username: data.reader_code.toLowerCase(),
                role: 'reader',
                full_name: data.full_name,
                email: data.email,
                created_at: todayStr
            });

            saveMockStore();
            return { message: `Cấp thẻ độc giả thành công! Tài khoản: ${data.reader_code.toLowerCase()} / 123456`, id: newReader.id };
        }

        if (method === 'PUT') {
            const readerId = parseInt(endpoint.split('/')[2]);
            const idx = mockStore.readers.findIndex(r => r.id == readerId);
            if (idx !== -1) {
                mockStore.readers[idx] = { ...mockStore.readers[idx], ...data };
                saveMockStore();
            }
            return { message: 'Cập nhật thẻ độc giả thành công! (Demo Mode)' };
        }

        return mockStore.readers;
    }

    // --- LOANS ---
    if (endpoint.startsWith('/loans')) {
        // Return book
        const returnMatch = endpoint.match(/\/loans\/(\d+)\/return$/);
        if (returnMatch && method === 'POST') {
            const loanId = parseInt(returnMatch[1]);
            const loan = mockStore.loans.find(l => l.id == loanId);
            if (!loan) throw new Error("Phiếu mượn không tồn tại");

            const todayStr = new Date().toISOString().split('T')[0];
            let fineAmount = 0;

            if (loan.due_date && todayStr > loan.due_date) {
                const dueDt = new Date(loan.due_date);
                const retDt = new Date(todayStr);
                const daysOverdue = Math.max(1, Math.floor((retDt - dueDt) / (1000 * 60 * 60 * 24)));
                fineAmount = daysOverdue * 5000;
            }

            // Restock book
            const book = mockStore.books.find(b => b.id == loan.book_id);
            if (book) {
                book.available_qty = (book.available_qty || 0) + 1;
            }

            // Delete / remove returned loan from history as requested by user
            mockStore.loans = mockStore.loans.filter(l => l.id != loanId);

            saveMockStore();

            let msg = `Trả sách thành công! Phiếu mượn đã hoàn tất và xóa khỏi danh sách.`;
            if (fineAmount > 0) {
                msg += ` Sách bị trễ hạn (Phạt ${fineAmount.toLocaleString()} VNĐ).`;
            }
            return { message: msg, fine_amount: fineAmount };
        }

        // Renew loan
        const renewMatch = endpoint.match(/\/loans\/(\d+)\/renew$/);
        if (renewMatch && method === 'POST') {
            const loanId = parseInt(renewMatch[1]);
            const loan = mockStore.loans.find(l => l.id == loanId);
            if (!loan) throw new Error("Phiếu mượn không tồn tại");
            if (loan.status === 'Đã trả') throw new Error("Sách đã được trả, không thể gia hạn");
            if ((loan.renewal_count || 0) >= 2) throw new Error("Phiếu mượn này đã đạt giới hạn tối đa 2 lần gia hạn!");

            const todayStr = new Date().toISOString().split('T')[0];
            
            // If loan is overdue (due_date < todayStr), extend +7 days from TODAY
            // If loan is not overdue (due_date >= todayStr), extend +7 days from existing due_date
            let baseDt;
            if (loan.due_date && loan.due_date >= todayStr) {
                baseDt = new Date(loan.due_date);
            } else {
                baseDt = new Date(todayStr);
            }

            baseDt.setDate(baseDt.getDate() + 7);
            const newDueStr = baseDt.toISOString().split('T')[0];

            loan.due_date = newDueStr;
            loan.renewal_count = (loan.renewal_count || 0) + 1;
            loan.status = 'Đang mượn';
            loan.fine_amount = 0;
            loan.fine_status = 'N/A';

            saveMockStore();
            return { message: `Gia hạn thành công! Hạn trả mới: ${newDueStr} (Lần gia hạn ${loan.renewal_count}/2). Trạng thái đã chuyển sang 'Đang mượn'.` };
        }

        // Pay fine
        const payFineMatch = endpoint.match(/\/loans\/(\d+)\/pay-fine$/);
        if (payFineMatch && method === 'POST') {
            const loanId = parseInt(payFineMatch[1]);
            const loan = mockStore.loans.find(l => l.id == loanId);
            if (!loan) throw new Error("Phiếu mượn không tồn tại");
            if (!loan.fine_amount || loan.fine_amount <= 0 || loan.fine_status === 'Đã nộp') {
                throw new Error("Không có khoản tiền phạt nào cần nộp cho phiếu này");
            }

            loan.fine_status = 'Đã nộp';
            saveMockStore();
            return { message: `Nộp tiền phạt ${loan.fine_amount.toLocaleString()} VNĐ thành công! (Demo Mode)` };
        }

        if (method === 'POST' && endpoint === '/loans') {
            const readerObj = mockStore.readers.find(r => r.id == data.reader_id);
            const bookObj = mockStore.books.find(b => b.id == data.book_id);
            const today = new Date();
            const due = new Date(today.getTime() + (data.borrow_days || 14) * 24 * 60 * 60 * 1000);
            
            const newLoan = {
                id: Date.now(),
                borrow_code: `PM${Date.now().toString().slice(-6)}`,
                reader_id: data.reader_id,
                reader_name: readerObj ? readerObj.full_name : 'Độc giả mượn',
                reader_code: readerObj ? readerObj.reader_code : 'DG00',
                book_id: data.book_id,
                book_title: bookObj ? bookObj.title : 'Sách mượn',
                book_code: bookObj ? bookObj.book_code : 'MS00',
                borrow_date: today.toISOString().split('T')[0],
                due_date: due.toISOString().split('T')[0],
                return_date: null,
                status: 'Đang mượn',
                renewal_count: 0,
                fine_amount: 0,
                fine_status: 'N/A',
                notes: data.notes || ''
            };

            mockStore.loans.unshift(newLoan);
            if (bookObj && bookObj.available_qty > 0) {
                bookObj.available_qty -= 1;
            }
            saveMockStore();
            return { message: `Tạo phiếu mượn ${newLoan.borrow_code} thành công! Hạn trả: ${newLoan.due_date}`, id: newLoan.id, borrow_code: newLoan.borrow_code };
        }

        let filteredLoans = [...mockStore.loans];

        // Parse query params if present (e.g. /loans?reader_id=2&status=Quá hạn)
        if (endpoint.includes('?')) {
            const queryString = endpoint.split('?')[1];
            const params = new URLSearchParams(queryString);
            const readerId = params.get('reader_id');
            const status = params.get('status');
            const q = params.get('q');

            if (readerId) {
                filteredLoans = filteredLoans.filter(l => l.reader_id == readerId);
            }
            if (status && status !== 'all') {
                filteredLoans = filteredLoans.filter(l => l.status === status);
            }
            if (q) {
                const qLower = q.toLowerCase();
                filteredLoans = filteredLoans.filter(l =>
                    (l.borrow_code || '').toLowerCase().includes(qLower) ||
                    (l.reader_name || '').toLowerCase().includes(qLower) ||
                    (l.reader_code || '').toLowerCase().includes(qLower) ||
                    (l.book_title || '').toLowerCase().includes(qLower)
                );
            }
        }

        return filteredLoans;
    }

    // --- USERS ---
    if (endpoint.startsWith('/users')) {
        if (method === 'POST') {
            const newUser = {
                id: Date.now(),
                ...data,
                created_at: new Date().toISOString().split('T')[0]
            };
            mockStore.users.unshift(newUser);
            saveMockStore();
            return { message: `Tạo tài khoản '${data.username}' thành công! (Demo Mode)`, id: newUser.id };
        }

        if (method === 'PUT') {
            const userId = parseInt(endpoint.split('/')[2]);
            const idx = mockStore.users.findIndex(u => u.id == userId);
            if (idx !== -1) {
                mockStore.users[idx] = { ...mockStore.users[idx], ...data };
                saveMockStore();
            }
            return { message: 'Cập nhật tài khoản người dùng thành công! (Demo Mode)' };
        }

        if (method === 'DELETE') {
            const userId = parseInt(endpoint.split('/')[2]);
            mockStore.users = mockStore.users.filter(u => u.id != userId);
            saveMockStore();
            return { message: 'Đã xóa tài khoản khỏi hệ thống (Demo Mode)' };
        }

        return mockStore.users;
    }

    // --- AI SEARCH ASSISTANT (RAG & General Conversational AI) ---
    if (endpoint.startsWith('/ai/search')) {
        const prompt = (data && data.prompt) ? data.prompt.trim() : '';
        const promptLower = prompt.toLowerCase();
        
        const words = promptLower.split(/\s+/).filter(w => w.length > 1);
        const matches = [];
        (mockStore.books || []).forEach(b => {
            let score = 0;
            const t = b.title.toLowerCase();
            const a = b.author.toLowerCase();
            const c = (b.category_name || '').toLowerCase();
            const d = (b.description || '').toLowerCase();

            words.forEach(w => {
                if (w.length > 2 && t.includes(w)) score += 4;
                if (w.length > 2 && c.includes(w)) score += 3;
                if (w.length > 2 && a.includes(w)) score += 3;
                if (w.length > 2 && d.includes(w)) score += 1;
            });
            if (score > 0) matches.push({ score, book: b });
        });

        matches.sort((x, y) => y.score - x.score);
        const topResults = matches.map(m => m.book).slice(0, 4);

        let reply = "";

        // 1. ICTU & University Knowledge Context
        if (['ictu', 'công nghệ thông tin và truyền thông thái nguyên', 'truyền thông thái nguyên', 'đại học cntt & tt', 'đại học cntt và truyền thông', 'tnu'].some(k => promptLower.includes(k))) {
            reply = "🏫 **ICTU (Trường Đại học Công nghệ Thông tin và Truyền thông - Đại học Thái Nguyên):**\n\n" +
                    "• **Tên đầy đủ:** Trường Đại học Công nghệ Thông tin và Truyền thông - ĐH Thái Nguyên.\n" +
                    "• **Tên tiếng Anh:** University of Information and Communication Technology (ICTU).\n" +
                    "• **Địa chỉ:** Đường Z115, xã Quyết Thắng, Thành phố Thái Nguyên, tỉnh Thái Nguyên.\n" +
                    "• **Giới thiệu:** ICTU là trường đại học công lập hàng đầu tại khu vực Trung du và Miền núi phía Bắc chuyên đào tạo nguồn nhân lực chất lượng cao về Công nghệ thông tin, Trí tuệ nhân tạo (AI), Khoa học dữ liệu, Công nghệ kỹ thuật điện tử - viễn thông, Truyền thông đa phương tiện và Kinh tế số.\n" +
                    "• **Thư viện ICTU:** Trang bị hàng chục nghìn đầu sách giáo trình, tài liệu chuyên ngành cùng hệ thống tra cứu RAG thông minh phục vụ cho học tập và nghiên cứu.";
        }
        // 2. RAG Concept Knowledge
        else if (['rag là gì', 'công nghệ rag', 'retrieval augmented generation'].some(k => promptLower.includes(k))) {
            reply = "🤖 **RAG (Retrieval-Augmented Generation):**\n\n" +
                    "RAG là kỹ thuật tiên tiến trong Trí tuệ Nhân tạo kết hợp giữa Mô hình Ngôn ngữ lớn (LLM) và Cơ sở dữ liệu tri thức thực tế.\n" +
                    "- **Cơ chế hoạt động:** Khi người dùng gửi câu hỏi, RAG sẽ **truy xuất (Retrieval)** các tài liệu, sách, bản ghi liên quan trong CSDL nội bộ, sau đó **tổng hợp (Augmented Generation)** để tạo ra câu trả lời chính xác, tránh hiện tượng ảo giác (hallucination).\n" +
                    "- **Ứng dụng:** Được tích hợp trực tiếp trong Thư viện thông minh này để giúp bạn tra cứu sách và thông tin mượn trả tức thì!";
        }
        // 3. RAG Context (Library rules & ops)
        else if (['gia hạn', 'hạn trả', 'mượn bao lâu', 'bao nhiêu ngày'].some(k => promptLower.includes(k))) {
            reply = "🤖 **Trợ lý AI (RAG System):** Quy định mượn trả & gia hạn thư viện:\n- Thời hạn mượn sách mặc định là **14 ngày**.\n- Mỗi độc giả được gia hạn tối đa **2 lần** (+7 ngày/lần gia hạn).\n- Điều kiện: Phiếu mượn chưa quá hạn và sách chưa có người khác đặt trước.";
        } else if (['phạt', 'nộp phạt', 'trễ hạn', 'bị trễ', 'phí trễ'].some(k => promptLower.includes(k))) {
            reply = "🤖 **Trợ lý AI (RAG System):** Quy định xử lý phạt trễ hạn:\n- Mức phạt quá hạn là **5.000 VNĐ / 1 ngày trễ** cho mỗi cuốn sách.\n- Độc giả cần hoàn tất thủ tục trả sách và nộp phạt tại mục *Quản lý Mượn/Trả/Phạt*.";
        } else if (['thẻ độc giả', 'tạo thẻ', 'làm thẻ', 'đăng ký thẻ', 'hạn thẻ'].some(k => promptLower.includes(k))) {
            reply = "🤖 **Trợ lý AI (RAG System):** Thông tin thẻ độc giả:\n- Thẻ có thời hạn sử dụng **2 năm** kể từ ngày cấp.\n- Độc giả có thể tra cứu thông tin thẻ tại mục *Hồ sơ cá nhân*.";
        } else if (['đặt trước', 'hàng chờ', 'hết sách'].some(k => promptLower.includes(k))) {
            reply = "🤖 **Trợ lý AI (RAG System):** Dịch vụ Đặt trước sách:\n- Khi cuốn sách hết bản sẵn có (Tồn: 0), bạn có thể nhấn **Đặt trước** để vào hàng chờ tự động.";
        }
        // 4. General Knowledge & Q&A
        else if (['chào', 'hello', 'hi', 'xin chào', 'bạn là ai', 'giới thiệu'].some(k => promptLower.includes(k))) {
            reply = "🤖 **Trợ lý Trí tuệ Nhân tạo (AI Chatbot):** Xin chào! Tôi là Trợ lý AI đa năng tích hợp công nghệ RAG của Thư viện ICTU. Tôi có thể hỗ trợ bạn:\n1. **Giải đáp thông tin trường ICTU & quy định thư viện**\n2. **Trả lời mọi câu hỏi kiến thức** (CNTT, AI, Khoa học, Lịch sử, Địa lý, Toán học, Văn học...)\n3. **Tra cứu & Gợi ý sách** thông minh trong kho dữ liệu\n\nBạn cần hỗ trợ câu hỏi gì hôm nay?";
        } else if (['python', 'lập trình', 'code', 'cú pháp', 'java', 'javascript', 'ai là gì', 'deep learning', 'máy học'].some(k => promptLower.includes(k))) {
            reply = `🤖 **Trợ lý AI (Kiến thức Công nghệ & Lập trình):**\nĐể học và phát triển kỹ năng lập trình:\n- **Python**: Ngôn ngữ cú pháp rõ ràng, rất thích hợp cho người mới bắt đầu, phân tích dữ liệu và Học máy (AI/Deep Learning).\n- **Cốt lõi**: Nắm vững cấu trúc điều khiển (\`if/else\`), vòng lặp (\`for/while\`), hàm (\`def\`), và lập trình hướng đối tượng (OOP).`;
        } else if (['toán', 'phương trình', 'công thức', 'tính', 'giải', 'diện tích', 'chu vi', 'bán kính'].some(k => promptLower.includes(k))) {
            reply = `🤖 **Trợ lý AI (Toán học & Khoa học):**\nTôi đã phân tích câu hỏi toán học/khoa học *"${prompt}"* của bạn. Nếu bạn cần tính toán cụ thể hoặc giải từng bước bài tập, hãy gửi chi tiết đề bài để tôi giải đáp nhé!`;
        } else if (['thủ đô', 'nước', 'quốc gia', 'lịch sử', 'chiến tranh', 'địa lý', 'thời kỳ', 'thế giới'].some(k => promptLower.includes(k))) {
            reply = `🤖 **Trợ lý AI (Lịch sử & Địa lý):**\nTôi đã tiếp nhận câu hỏi *"${prompt}"* của bạn. Bạn có thể đặt câu hỏi chi tiết hơn về các mốc lịch sử, sự kiện thế giới hoặc vị trí địa lý để tôi cung cấp câu trả lời chính xác nhất!`;
        } else if (['kỹ năng', 'giao tiếp', 'đắc nhân tâm', 'thành công', 'tư duy', 'thói quen', 'quản lý thời gian', 'tài chính'].some(k => promptLower.includes(k))) {
            reply = `🤖 **Trợ lý AI (Phát triển Bản thân & Kỹ năng):**\nĐể phát triển bản thân và tư duy tích cực:\n1. Duy trì **thói quen đọc sách** hàng ngày để nâng cao tri thức.\n2. Tăng cường **kỹ năng giao tiếp và thấu hiểu** trong công việc và cuộc sống.\n3. Quản lý thời gian hiệu quả và thiết lập mục tiêu rõ ràng.`;
        } else if (promptLower.includes('là gì') || promptLower.includes('là ai')) {
            const topic = prompt.replace(/là gì/gi, '').replace(/là ai/gi, '').replace(/\?/g, '').trim();
            reply = `🤖 **Giải đáp Trí tuệ Nhân tạo AI:**\n\n**${topic}** là khái niệm / đối tượng được tìm hiểu nhiều trong nghiên cứu và học tập. Bạn có thể tra cứu thêm các cuốn sách tài liệu chuyên ngành liên quan được liệt kê trong kho thư viện bên dưới!`;
        } else if (topResults.length > 0 && matches.length > 0 && matches[0].score >= 3) {
            reply = `🤖 **Trợ lý AI (RAG Search System):** Tôi đã tìm thấy ${topResults.length} cuốn sách phù hợp nhất với yêu cầu *"${prompt}"* của bạn trong thư viện:`;
        } else {
            reply = `🤖 **Trợ lý Trí tuệ Nhân tạo AI:**\nCảm ơn bạn đã gửi câu hỏi: *"${prompt}"*.\n\nTôi là Trợ lý AI đa năng, có thể hỗ trợ bạn giải đáp thông tin về trường ICTU, trả lời câu hỏi kiến thức chung cũng như tìm kiếm sách trong thư viện. Bạn có muốn tìm hiểu sâu hơn về khía cạnh nào của chủ đề này không?`;
        }

        const displayBooks = topResults.length > 0 ? topResults : mockStore.books.slice(0, 3);

        return {
            prompt: prompt,
            ai_response: reply,
            books: displayBooks
        };
    }

    // --- AI RECOMMENDATIONS ---
    if (endpoint.startsWith('/ai/recommend')) {
        return {
            ai_explanation: "🤖 **AI Recommendation Engine:** Trí tuệ nhân tạo đã tự động phân tích xu hướng đọc và gợi ý các cuốn sách phù hợp nhất cho bạn.",
            recommendations: mockStore.books.slice(0, 4)
        };
    }

    // --- AI SUMMARIZE ---
    if (endpoint.startsWith('/ai/summarize')) {
        const bookId = data ? data.book_id : null;
        const book = mockStore.books.find(b => b.id == bookId) || mockStore.books[0];
        
        const title = book ? book.title : 'Sách chọn';
        const author = book ? book.author : 'Tác giả';
        const cat = book ? (book.category_name || 'Khác') : 'Thể loại';
        const desc = book ? (book.description || 'Cuốn sách cung cấp nhiều kiến thức chuyên sâu và bài học giá trị.') : 'Nội dung phong phú.';

        return {
            book_id: book ? book.id : 1,
            title: title,
            author: author,
            category: cat,
            executive_summary: `Tác phẩm '${title}' của tác giả ${author} thuộc thể loại ${cat}. Đây là cuốn sách quan trọng mang lại nhiều góc nhìn thực tiễn, phân tích sâu sắc và ứng dụng hiệu quả.`,
            key_takeaways: [
                `Nắm vững các nguyên lý cốt lõi và tư duy căn bản của dòng sách ${cat}.`,
                `Các phương pháp và bí quyết thành công được tác giả ${author} đúc kết từ thực tế.`,
                `Ví dụ minh họa trực quan, sinh động, dễ áp dụng vào học tập và công việc.`,
                `Giải pháp vượt qua những khó khăn, thách thức phổ biến trong lĩnh vực này.`
            ],
            target_audience: "Dành cho sinh viên, giảng viên, người nghiên cứu và độc giả mong muốn phát triển tư duy chuyên môn.",
            full_ai_text: `💡 **Tóm tắt AI cho cuốn '${title}':**\n\n📌 **Nội dung nổi bật:** ${desc}\n\n🎯 **Đối tượng phù hợp:** Học sinh, sinh viên và độc giả quan tâm tới ${cat}.\n\n⭐ **Đánh giá AI:** 4.9/5 điểm.`
        };
    }

    // Profile & Reservations
    if (endpoint.startsWith('/reservations')) return [];
    if (endpoint.startsWith('/auth/profile')) {
        return state.currentUser || { id: 1, username: 'admin', role: 'admin', full_name: 'Quản trị viên Hệ thống', email: 'admin@library.edu.vn' };
    }

    return [];
}

// --- HELPER: FETCH API ---
async function fetchAPI(endpoint, method = 'GET', data = null) {
    const options = {
        method,
        headers: {
            'Content-Type': 'application/json'
        }
    };
    if (data) {
        options.body = JSON.stringify(data);
    }

    try {
        const response = await fetch(`${API_BASE}${endpoint}`, options);
        let result = {};
        try {
            result = await response.json();
        } catch (e) {}

        if (!response.ok) {
            const apiError = new Error(result.error || `Lỗi HTTP: ${response.status}`);
            apiError.isHttpError = true;
            throw apiError;
        }
        return result;
    } catch (err) {
        if (err.isHttpError) {
            showToast(err.message, 'error');
            throw err;
        }

        // Fallback to Demo Mock Data for Static GitHub Pages / Offline Server
        try {
            const mock = getMockData(endpoint, method, data);
            if (mock !== null) return mock;
        } catch (mockErr) {
            showToast(mockErr.message, 'error');
            throw mockErr;
        }

        showToast(err.message || 'Lỗi kết nối server', 'warning');
        throw err;
    }
}

// --- TOAST NOTIFICATION SYSTEM ---
function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    let icon = 'fa-circle-info';
    if (type === 'success') icon = 'fa-circle-check';
    if (type === 'error') icon = 'fa-circle-exclamation';
    if (type === 'warning') icon = 'fa-triangle-exclamation';

    toast.innerHTML = `
        <i class="fa-solid ${icon}"></i>
        <div>${message}</div>
    `;

    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(50px)';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// --- EVENT LISTENERS ---
function setupEventListeners() {
    // Mobile Navigation & Sidebar Controls
    const mobileMenuBtn = document.getElementById('mobileMenuBtn');
    const sidebarCloseBtn = document.getElementById('sidebarCloseBtn');
    const sidebarOverlay = document.getElementById('sidebarOverlay');
    const sidebar = document.querySelector('.sidebar');

    function openSidebar() {
        if (sidebar) sidebar.classList.add('active');
        if (sidebarOverlay) sidebarOverlay.classList.add('active');
        document.body.classList.add('sidebar-open');
    }

    function closeSidebar() {
        if (sidebar) sidebar.classList.remove('active');
        if (sidebarOverlay) sidebarOverlay.classList.remove('active');
        document.body.classList.remove('sidebar-open');
    }

    window.closeSidebar = closeSidebar;

    if (mobileMenuBtn) {
        mobileMenuBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (sidebar && sidebar.classList.contains('active')) {
                closeSidebar();
            } else {
                openSidebar();
            }
        });
    }

    if (sidebarCloseBtn) {
        sidebarCloseBtn.addEventListener('click', closeSidebar);
    }

    if (sidebarOverlay) {
        sidebarOverlay.addEventListener('click', closeSidebar);
    }

    // Navigation Tabs
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const tab = item.getAttribute('data-tab');
            switchTab(tab);
        });
    });

    // Theme Toggle
    document.getElementById('themeToggleBtn').addEventListener('click', toggleTheme);

    // Logout Action
    document.getElementById('headerLogoutBtn').addEventListener('click', handleLogout);
    document.getElementById('sidebarLogoutBtn').addEventListener('click', handleLogout);

    // Overlay Login Presets (Instant 1-Click Login)
    document.querySelectorAll('#loginOverlay .preset-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const user = btn.getAttribute('data-user');
            const pass = btn.getAttribute('data-pass');
            document.getElementById('overlayUsername').value = user;
            document.getElementById('overlayPassword').value = pass;
            
            const form = document.getElementById('overlayLoginForm');
            if (form && form.requestSubmit) {
                form.requestSubmit();
            } else if (form) {
                form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
            }
        });
    });

    document.getElementById('overlayLoginForm').addEventListener('submit', handleLoginSubmit);

    // View Toggle (Grid vs Table)
    document.getElementById('viewGridBtn').addEventListener('click', () => setBookViewMode('grid'));
    document.getElementById('viewTableBtn').addEventListener('click', () => setBookViewMode('table'));

    // Search & Filter Inputs
    document.getElementById('bookSearchInput').addEventListener('input', filterBooks);
    document.getElementById('bookCategoryFilter').addEventListener('change', filterBooks);
    document.getElementById('bookStatusFilter').addEventListener('change', filterBooks);
    document.getElementById('readerSearchInput').addEventListener('input', filterReaders);
    document.getElementById('readerStatusFilter').addEventListener('change', filterReaders);
    document.getElementById('loanSearchInput').addEventListener('input', filterLoans);
    document.getElementById('loanStatusFilter').addEventListener('change', filterLoans);
    document.getElementById('globalSearchInput').addEventListener('keyup', (e) => {
        if (e.key === 'Enter') {
            const val = e.target.value.trim();
            if (val) {
                switchTab('books');
                document.getElementById('bookSearchInput').value = val;
                filterBooks();
            }
        }
    });

    // User Profile Card click action (All roles)
    document.getElementById('userProfileCard').addEventListener('click', openProfileModal);

    // Modals Open Actions
    document.getElementById('addBookBtn').addEventListener('click', () => openBookModal());
    document.getElementById('addReaderBtn').addEventListener('click', () => openReaderModal());
    document.getElementById('createLoanBtn').addEventListener('click', () => openLoanModal());
    document.getElementById('quickBorrowBtn').addEventListener('click', () => openLoanModal());
    document.getElementById('addUserBtn').addEventListener('click', () => openUserModal());
    document.getElementById('viewAllLoansBtn').addEventListener('click', () => switchTab('loans'));

    // Modal Close buttons
    document.querySelectorAll('.modal-close, .modal-cancel').forEach(btn => {
        btn.addEventListener('click', () => {
            const modal = btn.closest('.modal');
            if (modal) closeModal(modal.id);
        });
    });

    // Modal forms submission
    document.getElementById('bookForm').addEventListener('submit', handleBookSubmit);
    document.getElementById('readerForm').addEventListener('submit', handleReaderSubmit);
    document.getElementById('loanForm').addEventListener('submit', handleLoanSubmit);
    document.getElementById('userForm').addEventListener('submit', handleUserSubmit);
    document.getElementById('profileForm').addEventListener('submit', handleProfileSubmit);


    // AI Chat
    document.getElementById('aiChatSendBtn').addEventListener('click', handleAiSearch);
    document.getElementById('aiChatInput').addEventListener('keyup', (e) => {
        if (e.key === 'Enter') handleAiSearch();
    });
    document.getElementById('refreshAiRecBtn').addEventListener('click', loadAiRecommendations);

    // Export Buttons
    document.getElementById('exportBooksBtn').addEventListener('click', exportBooksCSV);
    document.getElementById('exportReadersBtn').addEventListener('click', exportReadersCSV);
    document.getElementById('exportLoansBtn').addEventListener('click', exportLoansCSV);
    document.getElementById('printFullReportBtn').addEventListener('click', openFullReportPrint);
}

// --- USER PROFILE MODAL HANDLERS ---
async function openProfileModal() {
    if (!state.currentUser) return;

    openModal('profileModal');
    
    try {
        let profile = null;
        try {
            profile = await fetchAPI(`/auth/profile?user_id=${state.currentUser.id}`);
        } catch (err) {
            profile = state.currentUser;
        }

        if (!profile) profile = state.currentUser;

        document.getElementById('profileUserId').value = profile.id || state.currentUser.id;
        document.getElementById('profileHeaderName').textContent = profile.full_name || state.currentUser.full_name;
        document.getElementById('profileHeaderMeta').textContent = `@${profile.username || state.currentUser.username} • Tham gia: ${(profile.created_at || profile.issue_date || '2025-09-01').substring(0, 10)}`;
        
        const badge = document.getElementById('profileHeaderRoleBadge');
        const role = profile.role || state.currentUser.role;
        badge.className = `role-tag ${role}`;
        badge.textContent = role === 'admin' ? 'QUẢN TRỊ VIÊN' : (role === 'librarian' ? 'THỦ THƯ' : 'ĐỘC GIẢ');

        document.getElementById('profileFullName').value = profile.full_name || state.currentUser.full_name || '';
        document.getElementById('profileEmail').value = profile.email || state.currentUser.email || '';
        document.getElementById('profilePhone').value = profile.phone || state.currentUser.phone || '0901234567';
        document.getElementById('profilePassword').value = '';

        // Readonly Metadata
        document.getElementById('profileUsernameText').textContent = profile.username || state.currentUser.username;
        document.getElementById('profileRoleText').textContent = (profile.role || state.currentUser.role || 'READER').toUpperCase();
        document.getElementById('profileReaderCodeText').textContent = profile.reader_code || state.currentUser.reader_code || (profile.reader_id ? `DG${String(profile.reader_id).padStart(2, '0')}` : 'N/A');
        document.getElementById('profileCardStatusText').textContent = profile.card_status || profile.status || state.currentUser.card_status || 'Hoạt động';
        document.getElementById('profileExpiryText').textContent = profile.expiry_date || state.currentUser.expiry_date || '2027-09-01';
        document.getElementById('profileCreatedAtText').textContent = (profile.created_at || profile.issue_date || '2025-09-01').substring(0, 10);

    } catch (err) {
        console.error("Failed loading profile", err);
    }
}

async function handleProfileSubmit(e) {
    e.preventDefault();
    const userId = parseInt(document.getElementById('profileUserId').value);
    const data = {
        user_id: userId,
        full_name: document.getElementById('profileFullName').value.trim(),
        email: document.getElementById('profileEmail').value.trim(),
        phone: document.getElementById('profilePhone').value.trim(),
        password: document.getElementById('profilePassword').value.trim()
    };

    try {
        const res = await fetchAPI('/auth/profile', 'PUT', data);
        showToast(res.message, 'success');
        
        // Update local state currentUser
        state.currentUser.full_name = res.user.full_name;
        state.currentUser.email = res.user.email;
        localStorage.setItem('lib_user', JSON.stringify(state.currentUser));
        
        updateUserUI();
        closeModal('profileModal');
    } catch (err) {}
}

// --- USER & ROLE LOGIC ---
function updateUserUI() {

    if (!state.currentUser) return;
    const role = state.currentUser.role || 'reader';
    const roleTag = document.getElementById('sidebarUserRole');
    const userName = document.getElementById('sidebarUserName');
    const avatar = document.getElementById('sidebarAvatar');

    userName.textContent = state.currentUser.full_name || state.currentUser.username;
    roleTag.className = `role-tag ${role}`;

    if (role === 'admin') {
        roleTag.textContent = 'Quản trị viên';
        avatar.innerHTML = '<i class="fa-solid fa-user-shield"></i>';
    } else if (role === 'librarian') {
        roleTag.textContent = 'Thủ thư';
        avatar.innerHTML = '<i class="fa-solid fa-user-tie"></i>';
    } else {
        roleTag.textContent = 'Độc giả';
        avatar.innerHTML = '<i class="fa-solid fa-graduation-cap"></i>';
    }
}

function toggleTheme() {
    const body = document.body;
    const btn = document.getElementById('themeToggleBtn');
    if (body.classList.contains('theme-dark')) {
        body.classList.remove('theme-dark');
        body.classList.add('theme-light');
        btn.innerHTML = '<i class="fa-solid fa-sun"></i> <span>Giao diện Sáng</span>';
    } else {
        body.classList.remove('theme-light');
        body.classList.add('theme-dark');
        btn.innerHTML = '<i class="fa-solid fa-moon"></i> <span>Giao diện Tối</span>';
    }
}



// --- TAB SWITCHING ---
async function switchTab(tabId) {
    if (typeof window.closeSidebar === 'function') {
        window.closeSidebar();
    }
    state.activeTab = tabId;

    // Update Nav UI
    document.querySelectorAll('.nav-item').forEach(el => {
        if (el.getAttribute('data-tab') === tabId) {
            el.classList.add('active');
        } else {
            el.classList.remove('active');
        }
    });

    // Update Views
    document.querySelectorAll('.tab-view').forEach(view => {
        view.classList.remove('active');
    });

    const targetView = document.getElementById(`tab-${tabId}`);
    if (targetView) targetView.classList.add('active');

    const isReader = state.currentUser && state.currentUser.role === 'reader';

    // Page titles
    const titles = {
        'dashboard': ['Tổng quan Thư viện', 'Thống kê hoạt động & chỉ số thư viện thời gian thực'],
        'books': [isReader ? 'Tra cứu Sách' : 'Tra cứu & Quản lý Sách', isReader ? 'Tra cứu danh mục các đầu sách trong thư viện' : 'Danh mục đầu sách, tìm kiếm và quản lý kho sách'],
        'readers': ['Quản lý Độc giả', 'Danh sách thẻ thư viện, gia hạn và theo dõi trạng thái độc giả'],
        'loans': ['Quản lý Mượn / Trả / Phạt', 'Theo dõi lưu thông sách, tính tiền phạt quá hạn và gia hạn'],
        'my-loans': ['Lịch sử Mượn Sách', 'Danh sách các cuốn sách bạn đang mượn và hạn trả'],
        'reservations': ['Hàng chờ Đặt trước Sách', 'Quản lý danh sách độc giả đặt trước khi sách hết mượn'],
        'users': ['Quản lý Tài khoản & Phân quyền', 'Danh sách tài khoản hệ thống và cấp quyền Admin, Thủ thư, Độc giả'],
        'ai-assistant': ['Trợ lý AI & Gợi ý Sách', 'Tìm kiếm theo ngữ nghĩa và nhận khuyến nghị sách thông minh'],
        'reports': ['Báo cáo & Xuất dữ liệu', 'Xuất dữ liệu Excel/CSV và tạo báo cáo in ấn chính thức']
    };

    if (titles[tabId]) {
        document.getElementById('pageTitle').textContent = titles[tabId][0];
        document.getElementById('pageSubtitle').textContent = titles[tabId][1];
    }

    // Load tab-specific data
    if (tabId === 'dashboard') await loadDashboardData();
    if (tabId === 'books') await loadBooks();
    if (tabId === 'readers') await loadReaders();
    if (tabId === 'loans') await loadLoans();
    if (tabId === 'my-loans') await loadMyLoans();
    if (tabId === 'reservations') await loadReservations();
    if (tabId === 'users') await loadUsers();
    if (tabId === 'ai-assistant') await loadAiRecommendations();
}

// --- CATEGORIES LOADING ---
async function loadCategories() {
    try {
        state.categories = await fetchAPI('/categories');
        const selectFilter = document.getElementById('bookCategoryFilter');
        const selectForm = document.getElementById('bookFormCategory');

        selectFilter.innerHTML = '<option value="all">Tất cả thể loại</option>';
        selectForm.innerHTML = '<option value="">-- Chọn thể loại --</option>';

        state.categories.forEach(cat => {
            selectFilter.innerHTML += `<option value="${cat.id}">${cat.name}</option>`;
            selectForm.innerHTML += `<option value="${cat.id}">${cat.name}</option>`;
        });
    } catch (err) {
        console.error("Failed loading categories", err);
    }
}

// --- DASHBOARD & CHARTS ---
async function loadDashboardData() {
    try {
        const stats = await fetchAPI('/stats/dashboard');

        // Metric Cards
        document.getElementById('statTotalBooks').textContent = stats.book_stats.total_books || 0;
        document.getElementById('statAvailableCopies').textContent = stats.book_stats.available_copies || 0;
        document.getElementById('statTotalReaders').textContent = stats.reader_stats.total_readers || 0;
        document.getElementById('statActiveReaders').textContent = stats.reader_stats.active_readers || 0;
        document.getElementById('statActiveLoans').textContent = stats.loan_stats.active_loans || 0;
        document.getElementById('statOverdueLoans').textContent = stats.loan_stats.overdue_loans || 0;
        document.getElementById('statTotalFines').textContent = `${(stats.loan_stats.total_fines || 0).toLocaleString()} VNĐ`;

        // Render Overdue Table
        const overdueLoans = await fetchAPI('/loans?status=Quá hạn');
        renderOverdueTable(overdueLoans);

        // Render Charts
        renderTopBooksChart(stats.top_books);
        renderCategoryChart(stats.category_stats);
    } catch (err) {
        console.error("Failed loading dashboard data", err);
    }
}

function renderOverdueTable(overdueLoans) {
    const tbody = document.getElementById('overdueTableBody');
    if (!overdueLoans || overdueLoans.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="text-center py-4 text-muted">🎉 Không có sách nào bị quá hạn! Thư viện đang hoạt động rất tốt.</td></tr>`;
        return;
    }

    tbody.innerHTML = overdueLoans.map(loan => {
        const dueDt = new Date(loan.due_date);
        const today = new Date();
        const daysOverdue = Math.max(1, Math.floor((today - dueDt) / (1000 * 60 * 60 * 24)));

        return `
            <tr>
                <td><strong>${loan.borrow_code}</strong></td>
                <td>
                    <div><strong>${loan.reader_name}</strong></div>
                    <small class="text-muted">${loan.reader_code}</small>
                </td>
                <td>${loan.book_title}</td>
                <td>${loan.borrow_date}</td>
                <td><span class="text-danger"><strong>${loan.due_date}</strong></span></td>
                <td><span class="badge badge-danger">${daysOverdue} ngày</span></td>
                <td><strong class="text-danger">${(loan.fine_amount || 0).toLocaleString()} VNĐ</strong></td>
                <td>
                    <button onclick="processReturn(${loan.id})" class="btn btn-sm btn-success" title="Trả sách & tính phạt">
                        <i class="fa-solid fa-rotate-left"></i> Trả sách
                    </button>
                    ${loan.fine_status === 'Chưa nộp' ? `
                        <button onclick="processPayFine(${loan.id})" class="btn btn-sm btn-warning" title="Thu tiền phạt">
                            <i class="fa-solid fa-money-bill"></i> Thu phạt
                        </button>
                    ` : ''}
                </td>
            </tr>
        `;
    }).join('');
}

function renderTopBooksChart(topBooks) {
    const ctx = document.getElementById('topBooksChart').getContext('2d');
    if (state.charts.topBooks) state.charts.topBooks.destroy();

    const labels = topBooks.map(b => b.title.length > 20 ? b.title.substring(0, 20) + '...' : b.title);
    const data = topBooks.map(b => b.borrow_count);

    state.charts.topBooks = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Số lượt mượn',
                data: data,
                backgroundColor: 'rgba(99, 102, 241, 0.7)',
                borderColor: '#6366f1',
                borderWidth: 2,
                borderRadius: 8
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: { beginAtZero: true, ticks: { stepSize: 1 } }
            }
        }
    });
}

function renderCategoryChart(categoryStats) {
    const ctx = document.getElementById('categoryChart').getContext('2d');
    if (state.charts.category) state.charts.category.destroy();

    const labels = categoryStats.map(c => c.category_name);
    const data = categoryStats.map(c => c.total_copies);

    state.charts.category = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: [
                    '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4'
                ],
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'right', labels: { boxWidth: 12 } }
            }
        }
    });
}

// --- BOOK MANAGEMENT & LOOKUP ---
async function loadBooks() {
    try {
        state.books = await fetchAPI('/books');
        filterBooks();
    } catch (err) {
        console.error("Failed loading books", err);
    }
}

function filterBooks() {
    const q = document.getElementById('bookSearchInput').value.trim().toLowerCase();
    const cat = document.getElementById('bookCategoryFilter').value;
    const status = document.getElementById('bookStatusFilter').value;

    const filtered = state.books.filter(b => {
        const matchesQ = !q || (
            b.title.toLowerCase().includes(q) ||
            b.author.toLowerCase().includes(q) ||
            b.book_code.toLowerCase().includes(q) ||
            (b.publisher && b.publisher.toLowerCase().includes(q))
        );

        const matchesCat = (cat === 'all' || b.category_id == cat);
        let matchesStatus = true;
        if (status === 'available') matchesStatus = (b.available_qty > 0);
        if (status === 'out_of_stock') matchesStatus = (b.available_qty === 0);

        return matchesQ && matchesCat && matchesStatus;
    });

    renderBooksGrid(filtered);
    renderBooksTable(filtered);
}

function setBookViewMode(mode) {
    state.viewMode = mode;
    document.getElementById('viewGridBtn').classList.toggle('active', mode === 'grid');
    document.getElementById('viewTableBtn').classList.toggle('active', mode === 'table');

    document.getElementById('booksGridContainer').classList.toggle('hidden', mode !== 'grid');
    document.getElementById('booksTableContainer').classList.toggle('hidden', mode !== 'table');
}

function renderBooksGrid(booksList) {
    const container = document.getElementById('booksGridContainer');
    if (!booksList || booksList.length === 0) {
        container.innerHTML = `<div class="glass-panel full-width text-center py-5 text-muted">Không tìm thấy cuốn sách nào khớp với tìm kiếm của bạn.</div>`;
        return;
    }

    const isStaff = state.currentUser && (state.currentUser.role === 'admin' || state.currentUser.role === 'librarian');

    container.innerHTML = booksList.map(book => `
        <div class="book-card">
            <div class="book-cover-container">
                <img src="${book.cover_url || 'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=400&q=80'}" alt="${book.title}" class="book-cover" onerror="this.src='https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=400&q=80'">
                ${isStaff ? `
                    <div class="book-card-top-actions">
                        <button onclick="editBook(${book.id})" class="btn-card-top edit" title="Chỉnh sửa thông tin sách">
                            <i class="fa-solid fa-pen-to-square"></i> Sửa
                        </button>
                        <button onclick="deleteBook(${book.id})" class="btn-card-top delete" title="Xóa sách khỏi thư viện">
                            <i class="fa-solid fa-trash"></i>
                        </button>
                    </div>
                ` : ''}
            </div>
            <div class="book-card-body">
                <div class="book-category">${book.category_name} • ${book.book_code}</div>
                <h4 class="book-title">${book.title}</h4>
                <div class="book-author"><i class="fa-solid fa-feather"></i> ${book.author}</div>
                <div class="book-meta">
                    <span><i class="fa-solid fa-warehouse"></i> Tồn: <strong>${book.available_qty}/${book.total_qty}</strong></span>
                    <span><i class="fa-solid fa-location-dot"></i> ${book.rack_location || 'Kệ A1'}</span>
                </div>
            </div>
            <div class="book-card-actions">
                <button onclick="triggerAiSummarize(${book.id})" class="btn btn-sm btn-ai flex-1" title="Xem AI Tóm tắt">
                    <i class="fa-solid fa-sparkles"></i> AI Tóm tắt
                </button>
                ${isStaff ? (
                    book.available_qty > 0 ? `
                        <button onclick="handleBorrowClick(${book.id})" class="btn btn-sm btn-primary flex-1" title="Mượn sách ngay">
                            <i class="fa-solid fa-handshake"></i> Mượn sách
                        </button>
                    ` : `
                        <button onclick="reserveBook(${book.id})" class="btn btn-sm btn-warning flex-1" title="Đặt trước khi có sách">
                            <i class="fa-solid fa-bookmark"></i> Đặt trước
                        </button>
                    `
                ) : (
                    book.available_qty > 0 ? `
                        <span class="badge badge-success book-status-badge" title="Tình trạng: Sẵn sàng mượn">
                            <i class="fa-solid fa-circle-check"></i> Sẵn sàng
                        </span>
                    ` : `
                        <button onclick="reserveBook(${book.id})" class="btn btn-sm btn-warning" title="Đặt trước khi có sách">
                            <i class="fa-solid fa-bookmark"></i> Đặt trước
                        </button>
                    `
                )}
                ${isStaff ? `
                    <button onclick="editBook(${book.id})" class="btn btn-sm btn-icon" title="Chỉnh sửa thông tin sách"><i class="fa-solid fa-pen-to-square"></i></button>
                    <button onclick="deleteBook(${book.id})" class="btn btn-sm btn-icon text-danger" title="Xóa sách"><i class="fa-solid fa-trash"></i></button>
                ` : ''}
            </div>
        </div>
    `).join('');
}

function renderBooksTable(booksList) {
    const tbody = document.getElementById('booksTableBody');
    const isStaff = state.currentUser && (state.currentUser.role === 'admin' || state.currentUser.role === 'librarian');

    if (!booksList || booksList.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" class="text-center py-4 text-muted">Không tìm thấy dữ liệu.</td></tr>`;
        return;
    }

    tbody.innerHTML = booksList.map(b => `
        <tr>
            <td><strong>${b.book_code}</strong></td>
            <td><img src="${b.cover_url}" style="width:36px; height:48px; object-fit:cover; border-radius:4px;"></td>
            <td>
                <div><strong>${b.title}</strong></div>
                <small class="text-muted">NXB ${b.publisher} (${b.publish_year})</small>
            </td>
            <td>${b.author}</td>
            <td><span class="badge badge-info">${b.category_name}</span></td>
            <td>${b.publisher}</td>
            <td>${b.rack_location}</td>
            <td>
                <span class="badge ${b.available_qty > 0 ? 'badge-success' : 'badge-danger'}">
                    ${b.available_qty} / ${b.total_qty}
                </span>
            </td>
            <td>
                <button onclick="triggerAiSummarize(${b.id})" class="btn btn-sm btn-ai" title="AI Tóm tắt"><i class="fa-solid fa-sparkles"></i> Tóm tắt</button>
                ${isStaff ? (
                    b.available_qty > 0 ? `
                        <button onclick="handleBorrowClick(${b.id})" class="btn btn-sm btn-primary" title="Mượn sách"><i class="fa-solid fa-handshake"></i> Mượn sách</button>
                    ` : `
                        <button onclick="reserveBook(${b.id})" class="btn btn-sm btn-warning" title="Đặt trước"><i class="fa-solid fa-bookmark"></i> Đặt trước</button>
                    `
                ) : (
                    b.available_qty > 0 ? `
                        <span class="badge badge-success book-status-badge" title="Tình trạng: Sẵn sàng mượn">
                            <i class="fa-solid fa-circle-check"></i> Sẵn sàng
                        </span>
                    ` : `
                        <button onclick="reserveBook(${b.id})" class="btn btn-sm btn-warning" title="Đặt trước"><i class="fa-solid fa-bookmark"></i> Đặt trước</button>
                    `
                )}
                ${isStaff ? `
                    <button onclick="editBook(${b.id})" class="btn btn-sm btn-primary" title="Chỉnh sửa thông tin sách"><i class="fa-solid fa-pen-to-square"></i> Sửa</button>
                    <button onclick="deleteBook(${b.id})" class="btn btn-sm btn-outline text-danger" title="Xóa sách"><i class="fa-solid fa-trash"></i></button>
                ` : ''}
            </td>
        </tr>
    `).join('');
}

async function handleBorrowClick(bookId) {
    if (!state.currentUser) return;
    const isStaff = (state.currentUser.role === 'admin' || state.currentUser.role === 'librarian');

    if (isStaff) {
        quickBorrowBook(bookId);
    } else {
        // Reader self-borrowing
        const book = state.books.find(b => b.id === bookId);
        if (!book) return;

        const readerId = state.currentUser.reader_id;
        if (!readerId) {
            showToast("Tài khoản chưa có thẻ thư viện để thực hiện mượn sách!", "error");
            return;
        }

        if (!confirm(`Bạn có chắc chắn muốn đăng ký mượn cuốn sách "${book.title}" (Thời hạn 14 ngày) không?`)) return;

        try {
            const res = await fetchAPI('/loans', 'POST', {
                reader_id: readerId,
                book_id: bookId,
                borrow_days: 14,
                notes: 'Độc giả tự đăng ký mượn trực tuyến'
            });
            showToast(res.message, 'success');
            await loadBooks();
            if (state.activeTab === 'my-loans') await loadMyLoans();
        } catch (err) {}
    }
}


function openBookModal(book = null) {
    document.getElementById('bookFormId').value = book ? book.id : '';
    document.getElementById('bookFormCode').value = book ? book.book_code : `MS0${state.books.length + 1}`;
    document.getElementById('bookFormTitle').value = book ? book.title : '';
    document.getElementById('bookFormAuthor').value = book ? book.author : '';
    document.getElementById('bookFormCategory').value = book ? book.category_id : (state.categories[0]?.id || '');
    document.getElementById('bookFormPublisher').value = book ? book.publisher : 'NXB Trẻ';
    document.getElementById('bookFormYear').value = book ? book.publish_year : 2024;
    document.getElementById('bookFormTotalQty').value = book ? book.total_qty : 5;
    document.getElementById('bookFormRack').value = book ? book.rack_location : 'Kệ A1-01';
    document.getElementById('bookFormCover').value = book ? book.cover_url : '';
    document.getElementById('bookFormDesc').value = book ? book.description : '';

    const submitBtn = document.querySelector('#bookForm button[type="submit"]');
    if (submitBtn) {
        submitBtn.innerHTML = book ? '<i class="fa-solid fa-floppy-disk"></i> Cập nhật Sách' : '<i class="fa-solid fa-floppy-disk"></i> Lưu Sách Mới';
    }

    document.getElementById('bookModalTitle').innerHTML = book ? '<i class="fa-solid fa-pen-to-square"></i> Chỉnh sửa Thông tin Sách' : '<i class="fa-solid fa-book"></i> Thêm Sách Mới';
    openModal('bookModal');
}

async function handleBookSubmit(e) {
    e.preventDefault();
    const id = document.getElementById('bookFormId').value;
    const totalQty = parseInt(document.getElementById('bookFormTotalQty').value);
    
    // Find existing book if editing
    const existingBook = id ? state.books.find(b => b.id == id) : null;
    
    // Calculate available_qty preserving active loans
    let availableQty = totalQty;
    if (existingBook) {
        const qtyDiff = totalQty - (existingBook.total_qty || totalQty);
        availableQty = Math.max(0, (existingBook.available_qty || 0) + qtyDiff);
    }

    const data = {
        book_code: document.getElementById('bookFormCode').value.trim(),
        title: document.getElementById('bookFormTitle').value.trim(),
        author: document.getElementById('bookFormAuthor').value.trim(),
        category_id: parseInt(document.getElementById('bookFormCategory').value),
        publisher: document.getElementById('bookFormPublisher').value.trim(),
        publish_year: parseInt(document.getElementById('bookFormYear').value),
        total_qty: totalQty,
        available_qty: availableQty,
        rack_location: document.getElementById('bookFormRack').value.trim(),
        cover_url: document.getElementById('bookFormCover').value.trim(),
        description: document.getElementById('bookFormDesc').value.trim()
    };

    try {
        if (id) {
            const res = await fetchAPI(`/books/${id}`, 'PUT', data);
            showToast(res.message || 'Cập nhật thông tin sách thành công!', 'success');
        } else {
            const res = await fetchAPI('/books', 'POST', data);
            showToast(res.message || 'Thêm sách mới thành công!', 'success');
        }
        closeModal('bookModal');
        await loadBooks();
    } catch (err) {
        console.error("Lỗi khi lưu thông tin sách:", err);
    }
}

function editBook(id) {
    const book = state.books.find(b => b.id == id);
    if (book) {
        openBookModal(book);
    } else {
        showToast('Không tìm thấy dữ liệu cuốn sách!', 'error');
    }
}

async function deleteBook(id) {
    const book = state.books.find(b => b.id == id);
    const bookTitle = book ? book.title : 'cuốn sách này';
    if (!confirm(`Bạn có chắc chắn muốn xóa "${bookTitle}" khỏi thư viện không?`)) return;
    try {
        const res = await fetchAPI(`/books/${id}`, 'DELETE');
        showToast(res.message || 'Đã xóa sách khỏi hệ thống', 'success');
        await loadBooks();
    } catch (err) {
        console.error("Lỗi khi xóa sách:", err);
    }
}

// --- ADMIN USER MANAGEMENT & ROLE ASSIGNMENT ---
async function loadUsers() {
    if (!state.currentUser || state.currentUser.role !== 'admin') return;
    try {
        state.users = await fetchAPI('/users');
        renderUsersTable();
    } catch (err) {
        console.error("Failed loading users", err);
    }
}

function renderUsersTable() {
    const tbody = document.getElementById('usersTableBody');
    if (!state.users || state.users.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="text-center py-4 text-muted">Không tìm thấy tài khoản nào.</td></tr>`;
        return;
    }

    // Deduplicate user list by username and full_name + role to prevent duplicates
    const seen = new Set();
    const uniqueUsers = state.users.filter(u => {
        const key = u.username ? u.username.toLowerCase() : `${(u.full_name || '').toLowerCase()}_${u.role}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });

    tbody.innerHTML = uniqueUsers.map(u => {
        let roleBadge = `<span class="badge badge-info">Độc giả</span>`;
        if (u.role === 'admin') roleBadge = `<span class="badge badge-danger"><i class="fa-solid fa-user-shield"></i> Admin</span>`;
        if (u.role === 'librarian') roleBadge = `<span class="badge badge-success"><i class="fa-solid fa-user-tie"></i> Thủ thư</span>`;

        return `
            <tr>
                <td><strong>#${u.id}</strong></td>
                <td><strong>${u.username}</strong></td>
                <td>${u.full_name}</td>
                <td>${u.email || '<em class="text-muted">Chưa cập nhật</em>'}</td>
                <td>${roleBadge}</td>
                <td>${(u.created_at || '').substring(0, 10)}</td>
                <td>
                    <button onclick="editUser(${u.id})" class="btn btn-sm btn-outline"><i class="fa-solid fa-pen"></i> Sửa</button>
                    ${u.username !== 'admin' ? `
                        <button onclick="deleteUser(${u.id})" class="btn btn-sm btn-outline text-danger"><i class="fa-solid fa-trash"></i> Xóa</button>
                    ` : ''}
                </td>
            </tr>
        `;
    }).join('');
}

function openUserModal(user = null) {
    document.getElementById('userFormId').value = user ? user.id : '';
    document.getElementById('userFormUsername').value = user ? user.username : '';
    document.getElementById('userFormUsername').disabled = !!user; // Username cannot be changed on edit
    document.getElementById('userFormPassword').value = '';
    document.getElementById('userFormFullName').value = user ? user.full_name : '';
    document.getElementById('userFormEmail').value = user ? user.email : '';
    document.getElementById('userFormRole').value = user ? user.role : 'reader';

    document.getElementById('userModalTitle').innerHTML = user ? '<i class="fa-solid fa-pen"></i> Chỉnh sửa Tài Khoản' : '<i class="fa-solid fa-user-plus"></i> Thêm Tài Khoản Mới';
    openModal('userModal');
}

async function handleUserSubmit(e) {
    e.preventDefault();
    const id = document.getElementById('userFormId').value;
    const data = {
        username: document.getElementById('userFormUsername').value.trim(),
        password: document.getElementById('userFormPassword').value.trim(),
        full_name: document.getElementById('userFormFullName').value.trim(),
        email: document.getElementById('userFormEmail').value.trim(),
        role: document.getElementById('userFormRole').value
    };

    try {
        if (id) {
            await fetchAPI(`/users/${id}`, 'PUT', data);
            showToast('Cập nhật tài khoản người dùng thành công!', 'success');
        } else {
            const res = await fetchAPI('/users', 'POST', data);
            showToast(res.message, 'success');
        }
        closeModal('userModal');
        await loadUsers();
    } catch (err) {}
}

function editUser(id) {
    const user = state.users.find(u => u.id === id);
    if (user) openUserModal(user);
}

async function deleteUser(id) {
    if (!confirm("Bạn có chắc chắn muốn xóa tài khoản này khỏi hệ thống?")) return;
    try {
        const res = await fetchAPI(`/users/${id}`, 'DELETE');
        showToast(res.message, 'success');
        await loadUsers();
    } catch (err) {}
}

// --- READER MANAGEMENT ---
async function loadReaders() {
    try {
        state.readers = await fetchAPI('/readers');
        filterReaders();
    } catch (err) {
        console.error("Failed loading readers", err);
    }
}

function filterReaders() {
    const q = document.getElementById('readerSearchInput').value.trim().toLowerCase();
    const status = document.getElementById('readerStatusFilter').value;

    const filtered = state.readers.filter(r => {
        const matchesQ = !q || (
            r.full_name.toLowerCase().includes(q) ||
            r.reader_code.toLowerCase().includes(q) ||
            r.email.toLowerCase().includes(q) ||
            r.phone.includes(q)
        );
        const matchesStatus = (status === 'all' || r.status === status);
        return matchesQ && matchesStatus;
    });

    renderReadersTable(filtered);
}

function renderReadersTable(readersList) {
    const tbody = document.getElementById('readersTableBody');
    const isStaff = state.currentUser && (state.currentUser.role === 'admin' || state.currentUser.role === 'librarian');

    if (!readersList || readersList.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="text-center py-4 text-muted">Không tìm thấy độc giả nào.</td></tr>`;
        return;
    }

    const seen = new Set();
    const uniqueReaders = readersList.filter(r => {
        const key = (r.reader_code || r.id).toString().toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });

    tbody.innerHTML = uniqueReaders.map(r => `
        <tr>
            <td><strong>${r.reader_code}</strong></td>
            <td>
                <div><strong>${r.full_name}</strong></div>
                <small class="text-muted">Tài khoản: ${r.reader_code.toLowerCase()}</small>
            </td>
            <td>
                <div><i class="fa-solid fa-envelope"></i> ${r.email}</div>
                <small class="text-muted"><i class="fa-solid fa-phone"></i> ${r.phone}</small>
            </td>
            <td><span class="badge badge-info">${r.card_type}</span></td>
            <td>
                <span class="badge ${r.status === 'Hoạt động' ? 'badge-success' : (r.status === 'Hết hạn' ? 'badge-warning' : 'badge-danger')}">
                    ${r.status}
                </span>
            </td>
            <td>${r.issue_date}</td>
            <td>${r.expiry_date}</td>
            <td>
                ${isStaff ? `
                    <button onclick="editReader(${r.id})" class="btn btn-sm btn-outline"><i class="fa-solid fa-pen"></i> Sửa</button>
                    ${r.status === 'Hoạt động' ? `
                        <button onclick="toggleReaderStatus(${r.id}, 'Bị khóa')" class="btn btn-sm btn-outline text-danger" title="Khóa thẻ"><i class="fa-solid fa-lock"></i></button>
                    ` : `
                        <button onclick="toggleReaderStatus(${r.id}, 'Hoạt động')" class="btn btn-sm btn-outline text-success" title="Kích hoạt thẻ"><i class="fa-solid fa-unlock"></i></button>
                    `}
                ` : ''}
            </td>
        </tr>
    `).join('');
}

function openReaderModal(reader = null) {
    document.getElementById('readerFormId').value = reader ? reader.id : '';
    document.getElementById('readerFormCode').value = reader ? reader.reader_code : `DG00${state.readers.length + 1}`;
    document.getElementById('readerFormName').value = reader ? reader.full_name : '';
    document.getElementById('readerFormEmail').value = reader ? reader.email : '';
    document.getElementById('readerFormPhone').value = reader ? reader.phone : '';
    document.getElementById('readerFormCardType').value = reader ? reader.card_type : 'Sinh viên';
    document.getElementById('readerFormStatus').value = reader ? reader.status : 'Hoạt động';

    document.getElementById('readerModalTitle').innerHTML = reader ? '<i class="fa-solid fa-pen"></i> Sửa Thông tin Độc giả' : '<i class="fa-solid fa-id-card"></i> Cấp Thẻ Độc Giả Mới';
    openModal('readerModal');
}

async function handleReaderSubmit(e) {
    e.preventDefault();
    const id = document.getElementById('readerFormId').value;
    const data = {
        reader_code: document.getElementById('readerFormCode').value.trim(),
        full_name: document.getElementById('readerFormName').value.trim(),
        email: document.getElementById('readerFormEmail').value.trim(),
        phone: document.getElementById('readerFormPhone').value.trim(),
        card_type: document.getElementById('readerFormCardType').value,
        status: document.getElementById('readerFormStatus').value
    };

    try {
        if (id) {
            await fetchAPI(`/readers/${id}`, 'PUT', data);
            showToast('Cập nhật độc giả thành công!', 'success');
        } else {
            const res = await fetchAPI('/readers', 'POST', data);
            showToast(res.message, 'success');
        }
        closeModal('readerModal');
        await loadReaders();
    } catch (err) {}
}

function editReader(id) {
    const reader = state.readers.find(r => r.id === id);
    if (reader) openReaderModal(reader);
}

async function toggleReaderStatus(id, newStatus) {
    const reader = state.readers.find(r => r.id === id);
    if (!reader) return;
    try {
        await fetchAPI(`/readers/${id}`, 'PUT', {
            full_name: reader.full_name,
            email: reader.email,
            phone: reader.phone,
            card_type: reader.card_type,
            status: newStatus,
            expiry_date: reader.expiry_date
        });
        showToast(`Đã chuyển trạng thái thẻ thành '${newStatus}'`, 'success');
        await loadReaders();
    } catch (err) {}
}

// --- LOANS & FINES MANAGEMENT (STAFF VIEW & MY LOANS READER VIEW) ---
async function loadLoans() {
    try {
        const rawLoans = await fetchAPI('/loans');
        const todayStr = new Date().toISOString().split('T')[0];

        state.loans = (rawLoans || []).map(loan => {
            if (loan.status !== 'Đã trả') {
                if (loan.due_date && loan.due_date < todayStr) {
                    loan.status = 'Quá hạn';
                } else if (loan.due_date && loan.due_date >= todayStr) {
                    loan.status = 'Đang mượn';
                    loan.fine_amount = 0;
                    loan.fine_status = 'N/A';
                }
            }
            return loan;
        });

        filterLoans();
    } catch (err) {
        console.error("Failed loading loans", err);
    }
}

async function loadMyLoans() {
    if (!state.currentUser) return;

    let readerId = state.currentUser.reader_id;

    // If currentUser is reader but reader_id is missing, try resolving it
    if (!readerId && state.currentUser.role === 'reader') {
        try {
            if (!state.readers || state.readers.length === 0) {
                state.readers = await fetchAPI('/readers');
            }
            const userLower = (state.currentUser.username || '').toLowerCase();
            const matching = (state.readers || []).find(r =>
                r.reader_code.toLowerCase() === userLower ||
                (r.email && r.email.toLowerCase() === (state.currentUser.email || '').toLowerCase()) ||
                r.full_name === state.currentUser.full_name
            );
            if (matching) {
                readerId = matching.id;
                state.currentUser.reader_id = matching.id;
                state.currentUser.reader_code = matching.reader_code;
                localStorage.setItem('lib_user', JSON.stringify(state.currentUser));
            }
        } catch (e) {
            console.warn("Could not resolve reader_id automatically:", e);
        }
    }

    if (!readerId) {
        renderMyLoansTable([]);
        return;
    }

    try {
        const myLoans = await fetchAPI(`/loans?reader_id=${readerId}`);
        // Client-side strict filter by reader_id as double safety
        const filtered = Array.isArray(myLoans) ? myLoans.filter(l => l.reader_id == readerId) : [];
        renderMyLoansTable(filtered);
    } catch (err) {
        console.error("Failed loading personal loans", err);
    }
}

function renderMyLoansTable(loansList) {
    const tbody = document.getElementById('myLoansTableBody');
    const activeLoans = (loansList || []).filter(l => l.status !== 'Đã trả');

    if (!activeLoans || activeLoans.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="text-center py-4 text-muted">Bạn không có cuốn sách nào đang mượn từ thư viện.</td></tr>`;
        return;
    }

    tbody.innerHTML = activeLoans.map(loan => {
        let statusBadge = `<span class="badge badge-info">${loan.status}</span>`;
        if (loan.status === 'Đang mượn') statusBadge = `<span class="badge badge-info"><i class="fa-solid fa-clock"></i> Đang mượn</span>`;
        if (loan.status === 'Đã trả') statusBadge = `<span class="badge badge-success"><i class="fa-solid fa-check"></i> Đã trả</span>`;
        if (loan.status === 'Quá hạn') statusBadge = `<span class="badge badge-danger"><i class="fa-solid fa-triangle-exclamation"></i> Quá hạn</span>`;

        return `
            <tr>
                <td><strong>${loan.borrow_code}</strong></td>
                <td><strong>${loan.book_title}</strong> (${loan.book_code})</td>
                <td>${loan.borrow_date}</td>
                <td><strong>${loan.due_date}</strong></td>
                <td>${loan.return_date || '<em class="text-muted">Chưa trả</em>'}</td>
                <td>${statusBadge}</td>
                <td>
                    ${loan.fine_amount > 0 ? `<strong class="text-danger">${loan.fine_amount.toLocaleString()} VNĐ</strong>` : '0 VNĐ'}
                </td>
                <td>
                    ${loan.status !== 'Đã trả' ? `
                        <button onclick="processRenew(${loan.id})" class="btn btn-sm btn-outline">
                            <i class="fa-solid fa-calendar-plus"></i> Xin Gia hạn (+7d)
                        </button>
                    ` : '<span class="text-muted">Hoàn tất</span>'}
                </td>
            </tr>
        `;
    }).join('');
}

function filterLoans() {
    const q = document.getElementById('loanSearchInput').value.trim().toLowerCase();
    const status = document.getElementById('loanStatusFilter').value;

    const filtered = state.loans.filter(l => {
        if (l.status === 'Đã trả') return false; // Completely hide returned loans from history table
        const matchesQ = !q || (
            l.borrow_code.toLowerCase().includes(q) ||
            l.reader_name.toLowerCase().includes(q) ||
            l.book_title.toLowerCase().includes(q) ||
            l.reader_code.toLowerCase().includes(q)
        );
        const matchesStatus = (status === 'all' || l.status === status);
        return matchesQ && matchesStatus;
    });

    renderLoansTable(filtered);
}

function renderLoansTable(loansList) {
    const tbody = document.getElementById('loansTableBody');
    const activeLoans = (loansList || []).filter(l => l.status !== 'Đã trả');

    if (!activeLoans || activeLoans.length === 0) {
        tbody.innerHTML = `<tr><td colspan="10" class="text-center py-4 text-muted">Không có phiếu mượn nào đang lưu thông.</td></tr>`;
        return;
    }

    tbody.innerHTML = activeLoans.map(loan => {
        let statusBadge = `<span class="badge badge-info">${loan.status}</span>`;
        if (loan.status === 'Đang mượn') statusBadge = `<span class="badge badge-info"><i class="fa-solid fa-clock"></i> Đang mượn</span>`;
        if (loan.status === 'Quá hạn') statusBadge = `<span class="badge badge-danger"><i class="fa-solid fa-triangle-exclamation"></i> Quá hạn</span>`;

        return `
            <tr>
                <td><strong>${loan.borrow_code}</strong></td>
                <td>
                    <div><strong>${loan.reader_name}</strong></div>
                    <small class="text-muted">${loan.reader_code}</small>
                </td>
                <td>
                    <div><strong>${loan.book_title}</strong></div>
                    <small class="text-muted">Mã: ${loan.book_code}</small>
                </td>
                <td>${loan.borrow_date}</td>
                <td><strong>${loan.due_date}</strong></td>
                <td>${loan.return_date || '<em class="text-muted">Chưa trả</em>'}</td>
                <td>${statusBadge}</td>
                <td><span class="badge badge-secondary">${loan.renewal_count}/2 lần</span></td>
                <td>
                    ${loan.fine_amount > 0 ? `
                        <div class="text-danger"><strong>${loan.fine_amount.toLocaleString()} VNĐ</strong></div>
                        <small class="badge ${loan.fine_status === 'Đã nộp' ? 'badge-success' : 'badge-danger'}">${loan.fine_status}</small>
                    ` : '<span class="text-muted">0 VNĐ</span>'}
                </td>
                <td>
                    <button onclick="processReturn(${loan.id})" class="btn btn-sm btn-success" title="Trả sách">
                        <i class="fa-solid fa-rotate-left"></i> Trả sách
                    </button>
                    <button onclick="processRenew(${loan.id})" class="btn btn-sm btn-outline" title="Gia hạn +7 ngày">
                        <i class="fa-solid fa-calendar-plus"></i> Gia hạn
                    </button>
                    ${loan.fine_amount > 0 && loan.fine_status === 'Chưa nộp' ? `
                        <button onclick="processPayFine(${loan.id})" class="btn btn-sm btn-warning" title="Nộp tiền phạt">
                            <i class="fa-solid fa-money-bill"></i> Nộp phạt
                        </button>
                    ` : ''}
                </td>
            </tr>
        `;
    }).join('');
}

async function openLoanModal() {
    await loadReaders();
    await loadBooks();

    const readerSelect = document.getElementById('loanFormReader');
    const bookSelect = document.getElementById('loanFormBook');

    const activeReaders = state.readers.filter(r => r.status === 'Hoạt động');
    readerSelect.innerHTML = activeReaders.map(r => `<option value="${r.id}">${r.full_name} (${r.reader_code} - ${r.card_type})</option>`).join('');

    const availBooks = state.books.filter(b => b.available_qty > 0);
    bookSelect.innerHTML = availBooks.map(b => `<option value="${b.id}">${b.title} (${b.book_code} - Tồn: ${b.available_qty})</option>`).join('');

    openModal('loanModal');
}

function quickBorrowBook(bookId) {
    openLoanModal().then(() => {
        document.getElementById('loanFormBook').value = bookId;
    });
}

async function handleLoanSubmit(e) {
    e.preventDefault();
    const data = {
        reader_id: parseInt(document.getElementById('loanFormReader').value),
        book_id: parseInt(document.getElementById('loanFormBook').value),
        borrow_days: parseInt(document.getElementById('loanFormDays').value),
        notes: document.getElementById('loanFormNotes').value.trim()
    };

    try {
        const res = await fetchAPI('/loans', 'POST', data);
        showToast(res.message, 'success');
        closeModal('loanModal');
        await loadLoans();
        await loadBooks();
    } catch (err) {}
}

async function processReturn(loanId) {
    if (!confirm("Xác nhận hoàn tất thủ tục TRẢ SÁCH cho phiếu mượn này? (Phiếu mượn sẽ được xóa hoàn toàn khỏi danh sách)")) return;
    try {
        const res = await fetchAPI(`/loans/${loanId}/return`, 'POST');
        if (res && res.message) showToast(res.message, 'success');
        state.loans = (state.loans || []).filter(l => l.id != loanId);
        await loadLoans();
        await loadBooks();
        await loadDashboardData();
        if (state.activeTab === 'my-loans') await loadMyLoans();
    } catch (err) {
        console.error("Lỗi trả sách:", err);
    }
}

async function processRenew(loanId) {
    try {
        const res = await fetchAPI(`/loans/${loanId}/renew`, 'POST');
        if (res && res.message) showToast(res.message, 'success');
        await loadLoans();
        await loadDashboardData();
        if (state.activeTab === 'my-loans') await loadMyLoans();
    } catch (err) {
        console.error("Lỗi gia hạn:", err);
    }
}

async function processPayFine(loanId) {
    if (!confirm("Xác nhận đã thu đủ số tiền phạt trễ hạn của độc giả?")) return;
    try {
        const res = await fetchAPI(`/loans/${loanId}/pay-fine`, 'POST');
        if (res && res.message) showToast(res.message, 'success');
        await loadLoans();
        await loadDashboardData();
        if (state.activeTab === 'my-loans') await loadMyLoans();
    } catch (err) {
        console.error("Lỗi thu phạt:", err);
    }
}

// --- BOOK RESERVATIONS ---
async function loadReservations() {
    if (!state.currentUser) return;
    const isReader = (state.currentUser.role === 'reader');
    try {
        if (isReader) {
            const readerId = state.currentUser.reader_id;
            if (!readerId) {
                state.reservations = [];
            } else {
                state.reservations = await fetchAPI(`/reservations?reader_id=${readerId}`);
            }
        } else {
            state.reservations = await fetchAPI('/reservations');
        }
        renderReservationsTable();
    } catch (err) {
        console.error("Failed loading reservations", err);
    }
}

function renderReservationsTable() {
    const tbody = document.getElementById('reservationsTableBody');
    const isReader = state.currentUser && (state.currentUser.role === 'reader');

    if (!state.reservations || state.reservations.length === 0) {
        const emptyText = isReader 
            ? "Bạn chưa đặt trước cuốn sách nào. Dữ liệu của bạn hoàn toàn mới!" 
            : "Hiện tại không có yêu cầu đặt trước nào trong hệ thống.";
        tbody.innerHTML = `<tr><td colspan="8" class="text-center py-4 text-muted">${emptyText}</td></tr>`;
        return;
    }

    tbody.innerHTML = state.reservations.map(res => `
        <tr>
            <td><span class="badge badge-warning">Hàng chờ #${res.queue_order}</span></td>
            <td><strong>${res.book_title}</strong></td>
            <td>${res.book_code}</td>
            <td><strong>${res.reader_name}</strong></td>
            <td>${res.reader_code}</td>
            <td>${res.request_date}</td>
            <td><span class="badge ${res.status === 'Đang chờ' ? 'badge-info' : 'badge-secondary'}">${res.status}</span></td>
            <td>
                ${res.status === 'Đang chờ' ? `
                    <button onclick="cancelReservation(${res.id})" class="btn btn-sm btn-outline text-danger"><i class="fa-solid fa-xmark"></i> Hủy đặt</button>
                ` : ''}
            </td>
        </tr>
    `).join('');
}


async function reserveBook(bookId) {
    if (!state.currentUser) return;
    const readerId = state.currentUser.reader_id;
    if (!readerId) {
        showToast("Tài khoản độc giả này chưa có thẻ thư viện để thực hiện đặt trước!", "error");
        return;
    }

    try {
        const res = await fetchAPI('/reservations', 'POST', { book_id: bookId, reader_id: readerId });
        showToast(res.message, 'success');
        await loadReservations();
    } catch (err) {}
}

async function cancelReservation(resId) {
    if (!confirm("Hủy lượt đặt trước này?")) return;
    try {
        const res = await fetchAPI(`/reservations/${resId}`, 'DELETE');
        showToast(res.message, 'success');
        await loadReservations();
    } catch (err) {}
}

// --- AI ASSISTANT & RECOMMENDATIONS STUDIO ---
async function handleAiSearch() {
    const input = document.getElementById('aiChatInput');
    const prompt = input.value.trim();
    if (!prompt) return;

    const chatContainer = document.getElementById('aiChatMessages');

    // Render User Message
    chatContainer.innerHTML += `
        <div class="chat-message user">
            <div class="avatar"><i class="fa-solid fa-user"></i></div>
            <div class="bubble">${escapeHtml(prompt)}</div>
        </div>
    `;
    input.value = '';
    chatContainer.scrollTop = chatContainer.scrollHeight;

    // Render AI Thinking Placeholder
    const loadingId = 'ai-loading-' + Date.now();
    chatContainer.innerHTML += `
        <div class="chat-message ai" id="${loadingId}">
            <div class="avatar"><i class="fa-solid fa-robot"></i></div>
            <div class="bubble"><i class="fa-solid fa-spinner fa-spin"></i> Trợ lý AI đang suy nghĩ và tìm kiếm dữ liệu...</div>
        </div>
    `;
    chatContainer.scrollTop = chatContainer.scrollHeight;

    try {
        const apiKey = (localStorage.getItem('gemini_api_key') || '').trim();
        const res = await fetchAPI('/ai/search', 'POST', { prompt, api_key: apiKey });
        document.getElementById(loadingId).remove();

        let booksHTML = '';
        if (res.books && res.books.length > 0) {
            booksHTML = `
                <div style="margin-top: 10px; display: grid; gap: 8px;">
                    ${res.books.map(b => `
                        <div style="background: rgba(255,255,255,0.05); padding: 8px 12px; border-radius: 8px; display: flex; align-items: center; justify-content: space-between;">
                            <div>
                                <strong>📖 ${b.title}</strong> — <small>${b.author} (${b.category_name})</small>
                                <div style="font-size:0.75rem; color:var(--text-muted);">Trạng thái: Tồn ${b.available_qty}/${b.total_qty} bản</div>
                            </div>
                            <button onclick="triggerAiSummarize(${b.id})" class="btn btn-sm btn-ai"><i class="fa-solid fa-sparkles"></i> Tóm tắt</button>
                        </div>
                    `).join('')}
                </div>
            `;
        }

        const formattedReply = formatAiResponse(res.ai_response);

        chatContainer.innerHTML += `
            <div class="chat-message ai">
                <div class="avatar"><i class="fa-solid fa-robot"></i></div>
                <div class="bubble">
                    ${formattedReply}
                    ${booksHTML}
                </div>
            </div>
        `;
        chatContainer.scrollTop = chatContainer.scrollHeight;
    } catch (err) {
        document.getElementById(loadingId).remove();
    }
}

function formatAiResponse(text) {
    if (!text) return '';
    let formatted = text
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/\n/g, '<br>');
    return formatted;
}

async function loadAiRecommendations() {
    try {
        const readerId = state.currentUser ? state.currentUser.reader_id : null;
        const res = await fetchAPI('/ai/recommend', 'POST', { reader_id: readerId });
        document.getElementById('aiRecExplanation').innerHTML = `<i class="fa-solid fa-lightbulb text-warning"></i> ${res.ai_explanation}`;

        const container = document.getElementById('aiRecommendationsGrid');
        container.innerHTML = res.recommendations.map(b => `
            <div class="book-card" style="font-size:0.85rem;">
                <img src="${b.cover_url}" class="book-cover" style="height:140px;" onerror="this.src='https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=400&q=80'">
                <div class="book-card-body" style="padding:10px;">
                    <div class="book-category">${b.category_name}</div>
                    <strong style="font-size:0.95rem; line-height:1.2;">${b.title}</strong>
                    <small class="text-muted" style="margin-bottom:6px;">${b.author}</small>
                    <button onclick="triggerAiSummarize(${b.id})" class="btn btn-sm btn-ai full-width" style="margin-top:auto;">
                        <i class="fa-solid fa-sparkles"></i> Xem tóm tắt AI
                    </button>
                </div>
            </div>
        `).join('');
    } catch (err) {}
}

async function triggerAiSummarize(bookId) {
    openModal('aiSummaryModal');
    const modalBody = document.getElementById('aiSummaryModalBody');
    modalBody.innerHTML = `<div class="loading-spinner py-5 text-center"><i class="fa-solid fa-circle-notch fa-spin text-ai" style="font-size:2rem;"></i><br><br>Đang gọi Trí tuệ Nhân tạo để phân tích nội dung cuốn sách...</div>`;

    try {
        const summary = await fetchAPI('/ai/summarize', 'POST', { book_id: bookId });
        modalBody.innerHTML = `
            <div class="ai-summary-container">
                <div style="display:flex; gap:1.5rem; margin-bottom:1.5rem;">
                    <div style="flex:1;">
                        <h3 style="color:var(--accent-indigo); font-size:1.4rem;">${summary.title}</h3>
                        <p><strong>Tác giả:</strong> ${summary.author} | <strong>Thể loại:</strong> <span class="badge badge-info">${summary.category}</span></p>
                    </div>
                </div>

                <div class="glass-panel" style="background:rgba(99, 102, 241, 0.08); border-color:rgba(99, 102, 241, 0.25); padding:1rem; margin-bottom:1rem;">
                    <h4 style="color:#c084fc; margin-bottom:0.5rem;"><i class="fa-solid fa-lightbulb"></i> Tóm tắt Điều hành (Executive Summary)</h4>
                    <p style="font-size:0.95rem;">${summary.executive_summary}</p>
                </div>

                <div class="glass-panel" style="padding:1rem; margin-bottom:1rem;">
                    <h4 style="margin-bottom:0.5rem;"><i class="fa-solid fa-key text-warning"></i> Giá trị & Bài học Cốt lõi (Key Takeaways)</h4>
                    <ul style="padding-left:1.2rem; display:flex; flex-direction:column; gap:0.4rem;">
                        ${summary.key_takeaways.map(item => `<li>${item}</li>`).join('')}
                    </ul>
                </div>

                <div class="glass-panel" style="padding:1rem;">
                    <h4 style="margin-bottom:0.3rem;"><i class="fa-solid fa-bullseye text-success"></i> Đối tượng Khuyên đọc</h4>
                    <p style="font-size:0.9rem; color:var(--text-secondary);">${summary.target_audience}</p>
                </div>
            </div>
        `;
    } catch (err) {
        modalBody.innerHTML = `<div class="text-danger py-4">Không thể lấy tóm tắt AI. Vui lòng thử lại sau.</div>`;
    }
}

// --- EXPORT FUNCTIONS (CSV/EXCEL & PRINT) ---
function exportBooksCSV() {
    if (!state.books || state.books.length === 0) { showToast('Không có dữ liệu sách để xuất', 'warning'); return; }
    let csv = '\uFEFFMã Sách,Tên Sách,Tác Giả,Thể Loại,Nhà Xuất Bản,Năm XB,Tổng Số,Còn Lại,Vị Trí Kệ\n';
    state.books.forEach(b => {
        csv += `"${b.book_code}","${b.title.replace(/"/g, '""')}","${b.author}","${b.category_name}","${b.publisher}",${b.publish_year},${b.total_qty},${b.available_qty},"${b.rack_location}"\n`;
    });
    downloadFile(csv, `Danh_sach_Sach_Thuvien_${new Date().toISOString().slice(0,10)}.csv`);
}

function exportReadersCSV() {
    if (!state.readers || state.readers.length === 0) { showToast('Không có dữ liệu độc giả để xuất', 'warning'); return; }
    let csv = '\uFEFFMã Thẻ,Họ Và Tên,Email,Số Điện Thoại,Loại Độc Giả,Trạng Thái,Ngày Cấp,Ngày Hết Hạn\n';
    state.readers.forEach(r => {
        csv += `"${r.reader_code}","${r.full_name}","${r.email}","${r.phone}","${r.card_type}","${r.status}","${r.issue_date}","${r.expiry_date}"\n`;
    });
    downloadFile(csv, `Danh_sach_Doc_Gia_${new Date().toISOString().slice(0,10)}.csv`);
}

function exportLoansCSV() {
    if (!state.loans || state.loans.length === 0) { showToast('Không có dữ liệu phiếu mượn để xuất', 'warning'); return; }
    let csv = '\uFEFFMã Phiếu,Tên Độc Giả,Mã Độc Giả,Tên Sách,Ngày Mượn,Hạn Trả,Ngày Trả Thực Tế,Trạng Thái,Tiền Phạt\n';
    state.loans.forEach(l => {
        csv += `"${l.borrow_code}","${l.reader_name}","${l.reader_code}","${l.book_title.replace(/"/g, '""')}","${l.borrow_date}","${l.due_date}","${l.return_date || ''}","${l.status}",${l.fine_amount || 0}\n`;
    });
    downloadFile(csv, `Bao_Cao_Muon_Tra_${new Date().toISOString().slice(0,10)}.csv`);
}

function downloadFile(content, filename) {
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast(`Đã xuất dữ liệu thành công: ${filename}`, 'success');
}

async function openPrintTicket(loanId) {
    const loan = state.loans.find(l => l.id === loanId);
    if (!loan) return;

    const printBody = document.getElementById('printAreaContent');
    printBody.innerHTML = `
        <div class="print-header">
            <h2>THƯ VIỆN TRƯỜNG HỌC / THƯ VIỆN THÔNG MINH AI</h2>
            <p>Địa chỉ: Đường Đại Học, Q. Cầu Giấy, Hà Nội | Hotline: 024.3838.9999</p>
            <h3 style="margin-top:15px; text-transform:uppercase;">PHIẾU XÁC NHẬN MƯỢN / TRẢ SÁCH</h3>
            <p><em>Mã phiếu: ${loan.borrow_code}</em></p>
        </div>

        <table style="width:100%; border-collapse:collapse; margin-bottom:20px;">
            <tr><td><strong>Độc giả:</strong> ${loan.reader_name} (${loan.reader_code})</td> <td><strong>Ngày mượn:</strong> ${loan.borrow_date}</td></tr>
            <tr><td><strong>SĐT:</strong> ${loan.reader_phone || '0901234567'}</td> <td><strong>Hạn trả sách:</strong> ${loan.due_date}</td></tr>
            <tr><td><strong>Tên sách mượn:</strong> ${loan.book_title}</td> <td><strong>Trạng thái:</strong> ${loan.status}</td></tr>
            <tr><td><strong>Vị trí kệ:</strong> Kệ A1-01</td> <td><strong>Tiền phạt (nếu quá hạn):</strong> ${(loan.fine_amount || 0).toLocaleString()} VNĐ</td></tr>
        </table>

        <p style="font-style:italic; font-size:0.9rem;">* Quy định: Độc giả giữ gìn sách cẩn thận, không làm rách hay đánh dấu vào sách. Trả sách quá hạn chịu phạt 5.000 VNĐ/ngày.</p>

        <div class="print-signatures">
            <div>
                <p><strong>NGƯỜI MƯỢN SÁCH</strong></p>
                <br><br><br>
                <p>${loan.reader_name}</p>
            </div>
            <div>
                <p><strong>THỦ THƯ XÁC NHẬN</strong></p>
                <br><br><br>
                <p>Thủ thư Mai</p>
            </div>
        </div>
    `;
    openModal('printModal');
}

async function openFullReportPrint() {
    await loadDashboardData();
    const printBody = document.getElementById('printAreaContent');
    const today = new Date().toLocaleDateString('vi-VN');

    printBody.innerHTML = `
        <div class="print-header">
            <h2>BÁO CÁO TỔNG QUAN HOẠT ĐỘNG THƯ VIỆN</h2>
            <p>Ngày lập báo cáo: ${today}</p>
        </div>

        <h3>1. Chỉ số Tổng quan</h3>
        <table class="print-table">
            <tr><th>Chỉ số</th><th>Số lượng</th></tr>
            <tr><td>Tổng số đầu sách trong kho</td><td>${document.getElementById('statTotalBooks').textContent}</td></tr>
            <tr><td>Tổng số độc giả đăng ký</td><td>${document.getElementById('statTotalReaders').textContent}</td></tr>
            <tr><td>Số phiếu mượn đang lưu hành</td><td>${document.getElementById('statActiveLoans').textContent}</td></tr>
            <tr><td>Số phiếu mượn quá hạn</td><td>${document.getElementById('statOverdueLoans').textContent}</td></tr>
            <tr><td>Tổng tiền phạt trễ hạn</td><td>${document.getElementById('statTotalFines').textContent}</td></tr>
        </table>

        <h3 style="margin-top:20px;">2. Danh sách Phiếu mượn Quá hạn cần xử lý</h3>
        ${document.getElementById('overdueTable').outerHTML}

        <div class="print-signatures">
            <div>
                <p><strong>NGƯỜI LẬP BÁO CÁO</strong></p>
                <br><br><br>
                <p>${state.currentUser ? state.currentUser.full_name : ''}</p>
            </div>
            <div>
                <p><strong>BAN GIÁM HIỆU / QUẢN LÝ</strong></p>
                <br><br><br>
                <p>(Ký & đóng dấu)</p>
            </div>
        </div>
    `;
    openModal('printModal');
}

// --- MODAL UTILS ---
function openModal(id) {
    const modal = document.getElementById(id);
    if (modal) modal.classList.add('active');
}

function closeModal(id) {
    const modal = document.getElementById(id);
    if (modal) modal.classList.remove('active');
}

function escapeHtml(text) {
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
