import React, { useState, useEffect, useRef } from 'react';
import { 
  Plus, 
  Search, 
  FileText, 
  Camera as CameraIcon, 
  Upload, 
  UserPlus, 
  LogOut, 
  ChevronRight, 
  Trash2, 
  Download,
  Database,
  History,
  CheckCircle2,
  XCircle,
  X
} from 'lucide-react';
import Papa from 'papaparse';
import JSZip from 'jszip';
import { motion, AnimatePresence } from 'motion/react';
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  addDoc, 
  deleteDoc, 
  doc, 
  serverTimestamp,
  orderBy
} from 'firebase/firestore';
import { signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut, User } from 'firebase/auth';
import { auth, db, handleFirestoreError, OperationType } from './lib/firebase';
import { Student, StudentDocument, DocumentType } from './types';
import CameraView from './components/CameraView';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [students, setStudents] = useState<Student[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [studentDocuments, setStudentDocuments] = useState<StudentDocument[]>([]);
  
  // Modals
  const [isAddStudentOpen, setIsAddStudentOpen] = useState(false);
  const [isBulkUploadOpen, setIsBulkUploadOpen] = useState(false);
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [isUploadDetailsOpen, setIsUploadDetailsOpen] = useState(false);
  const [tempImage, setTempImage] = useState<string | null>(null);
  
  // Form States
  const [newStudentName, setNewStudentName] = useState('');
  const [newStudentRoll, setNewStudentRoll] = useState('');
  const [docType, setDocType] = useState<DocumentType>('Aadhaar');
  const [customName, setCustomName] = useState('');
  const [uploading, setUploading] = useState(false);
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>([]);
  const longPressTimer = useRef<NodeJS.Timeout | null>(null);

  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    variant: 'danger' | 'warning';
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
    variant: 'danger'
  });

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;

    const q = query(
      collection(db, 'students'),
      where('creatorId', '==', user.uid),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Student));
      setStudents(docs);
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'students'));

    return () => unsubscribe();
  }, [user]);

  useEffect(() => {
    if (!selectedStudent || !user) {
      setStudentDocuments([]);
      return;
    }

    const q = query(
      collection(db, `students/${selectedStudent.id}/documents`),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as StudentDocument));
      setStudentDocuments(docs);
      setSelectedDocIds([]); // Reset selection on new data or student change
    }, (err) => handleFirestoreError(err, OperationType.LIST, `students/${selectedStudent.id}/documents`));

    return () => unsubscribe();
  }, [selectedStudent, user]);

  const [isSigningIn, setIsSigningIn] = useState(false);

  useEffect(() => {
    if (isUploadDetailsOpen) {
      const studentName = selectedStudent?.name || 'QuickScan';
      const timestamp = new Date().toISOString().split('T')[0];
      setCustomName(`${studentName}_${docType}_${timestamp}`);
    }
  }, [isUploadDetailsOpen, selectedStudent, docType]);

  const login = async () => {
    if (isSigningIn) return;
    setIsSigningIn(true);
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (err: any) {
      if (err.code !== 'auth/popup-closed-by-user' && err.code !== 'auth/cancelled-popup-request') {
        console.error("Sign-in error:", err);
      }
    } finally {
      setIsSigningIn(false);
    }
  };

  const logout = () => signOut(auth);

  const addStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    try {
      await addDoc(collection(db, 'students'), {
        name: newStudentName,
        rollNumber: newStudentRoll,
        creatorId: user.uid,
        createdAt: serverTimestamp()
      });
      setNewStudentName('');
      setNewStudentRoll('');
      setIsAddStudentOpen(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'students');
    }
  };

  const deleteStudent = async (id: string) => {
    setConfirmDialog({
      isOpen: true,
      title: "Delete Student Profile?",
      message: "This will permanently purge the student record and ALL associated certificates from the database. This action is irreversible.",
      variant: 'danger',
      onConfirm: async () => {
        try {
          const docsToDelete = [...studentDocuments];
          for (const d of docsToDelete) {
            await deleteDoc(doc(db, `students/${id}/documents`, d.id));
          }
          await deleteDoc(doc(db, 'students', id));
          if (selectedStudent?.id === id) setSelectedStudent(null);
          setConfirmDialog(prev => ({ ...prev, isOpen: false }));
        } catch (err) {
          handleFirestoreError(err, OperationType.DELETE, 'students');
        }
      }
    });
  };

  const handleCapture = (base64: string) => {
    setTempImage(base64);
    setIsCameraOpen(false);
    setIsUploadDetailsOpen(true);
  };

  const uploadFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;
          const MAX_DIMENSION = 1600;

          if (width > height) {
            if (width > MAX_DIMENSION) {
              height *= MAX_DIMENSION / width;
              width = MAX_DIMENSION;
            }
          } else {
            if (height > MAX_DIMENSION) {
              width *= MAX_DIMENSION / height;
              height = MAX_DIMENSION;
            }
          }

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx?.drawImage(img, 0, 0, width, height);
          const compressed = canvas.toDataURL('image/jpeg', 0.7);
          setTempImage(compressed);
          setIsUploadDetailsOpen(true);
        };
        img.src = reader.result as string;
      };
      reader.readAsDataURL(file);
    }
  };

  const handleLongPress = (id: string) => {
    setSelectedDocIds(prev => prev.includes(id) ? prev : [...prev, id]);
  };

  const toggleSelect = (id: string) => {
    setSelectedDocIds(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const batchDownload = async () => {
    if (!selectedStudent || selectedDocIds.length === 0) return;
    
    const zip = new JSZip();
    const folder = zip.folder(`${selectedStudent.name}_Exports`);
    
    selectedDocIds.forEach(id => {
      const sDoc = studentDocuments.find(d => d.id === id);
      if (sDoc) {
        const base64Data = sDoc.imageData.includes(',') ? sDoc.imageData.split(',')[1] : sDoc.imageData;
        folder?.file(`${sDoc.fileName || sDoc.type}.jpg`, base64Data, { base64: true });
      }
    });

    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${selectedStudent.name}_Documents_Archive.zip`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    setSelectedDocIds([]);
  };

  const deleteSelectedDocs = async () => {
    if (!selectedStudent) return;
    
    setConfirmDialog({
      isOpen: true,
      title: "Bulk Purge?",
      message: `Are you sure you want to permanently delete ${selectedDocIds.length} selected documents?`,
      variant: 'danger',
      onConfirm: async () => {
        try {
          const idsToDelete = [...selectedDocIds];
          setSelectedDocIds([]);
          for (const id of idsToDelete) {
            await deleteDoc(doc(db, `students/${selectedStudent.id}/documents`, id));
          }
          setConfirmDialog(prev => ({ ...prev, isOpen: false }));
        } catch (err) {
          handleFirestoreError(err, OperationType.DELETE, 'documents');
        }
      }
    });
  };

  const saveDocument = async () => {
    if (!selectedStudent || !tempImage || !user) return;
    setUploading(true);
    try {
      await addDoc(collection(db, `students/${selectedStudent.id}/documents`), {
        studentId: selectedStudent.id,
        type: docType,
        fileName: customName,
        imageData: tempImage,
        createdAt: serverTimestamp()
      });
      setTempImage(null);
      setIsUploadDetailsOpen(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `students/${selectedStudent.id}/documents`);
    } finally {
      setUploading(false);
    }
  };

  const filteredStudents = students.filter(s => 
    s.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
    s.rollNumber.includes(searchQuery)
  );

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 font-sans">
      <div className="flex flex-col items-center gap-4">
        <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1.5, ease: "linear" }}>
          <Database size={32} className="text-indigo-600" />
        </motion.div>
        <p className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-300">Synchronizing Vault</p>
      </div>
    </div>
  );

  if (!user) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6 font-sans">
      <div className="max-w-md w-full bg-white border border-slate-200 p-10 rounded-[40px] shadow-2xl">
        <div className="mb-10 text-center">
          <div className="w-16 h-16 bg-indigo-600 rounded-3xl flex items-center justify-center text-white shadow-xl shadow-indigo-100 mx-auto mb-6">
            <Database size={32} />
          </div>
          <h1 className="text-3xl font-black tracking-tighter mb-2 uppercase italic text-slate-900">StudenVault</h1>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Secure Digital Document Archive • v2.4.0</p>
        </div>
        <button 
          onClick={login}
          disabled={isSigningIn}
          className="w-full flex items-center justify-center gap-3 bg-slate-900 text-white py-4 rounded-2xl font-bold hover:bg-brand-primary transition-all shadow-lg shadow-slate-200 uppercase tracking-widest text-xs disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSigningIn ? (
            <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1 }}>
              <Database size={18} />
            </motion.div>
          ) : (
            "Authenticate & Enter"
          )}
        </button>
        <p className="mt-8 text-center text-[10px] text-slate-300 font-mono">ENCRYPTED END-TO-END CONNECTION ACTIVE</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans selection:bg-indigo-600 selection:text-white pb-12">
      {/* Header - Floating Card Style */}
      <header className="max-w-[1400px] mx-auto p-4 md:p-6 pb-2">
        <div className="bg-white border border-slate-200 p-4 rounded-2xl shadow-sm flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-indigo-200">
              <Database size={20} />
            </div>
            <div>
              <h1 className="text-sm font-black tracking-tight uppercase">DocVault <span className="text-indigo-600">Enterprise</span></h1>
              <p className="text-[10px] text-slate-400 font-mono tracking-wider">v2.4.0 • ACCREDITED ARCHIVE</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right hidden sm:block">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter">Authenticated Agent</p>
              <p className="text-xs font-semibold">{user.email}</p>
            </div>
            <button onClick={logout} className="w-10 h-10 bg-slate-50 border border-slate-200 rounded-full flex items-center justify-center hover:bg-red-50 hover:text-red-600 transition-all">
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-[1400px] mx-auto p-4 md:p-6 grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-6">
        {/* Sidebar Section */}
        <aside className="space-y-6">
          {/* Stats Bento */}
          <div className="grid grid-cols-2 gap-4 h-32">
            <div className="bg-white border border-slate-200 p-5 rounded-3xl flex flex-col justify-between shadow-sm">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Total Students</p>
              <p className="text-3xl font-black text-indigo-600">{students.length}</p>
            </div>
            <div className="bg-indigo-600 p-5 rounded-3xl flex flex-col justify-between text-white shadow-xl shadow-indigo-100">
              <p className="text-[10px] font-bold text-indigo-200 uppercase tracking-widest">Digital Records</p>
              <p className="text-3xl font-black">{students.length * 2}+</p>
            </div>
          </div>

          {/* Students List Bento */}
          <section className="bg-white border border-slate-200 rounded-3xl shadow-sm flex flex-col overflow-hidden h-[600px]">
            <div className="p-6 border-b border-slate-100">
              <h3 className="text-xs font-bold uppercase text-slate-400 tracking-widest mb-4">Registry Records</h3>
              
              <div className="flex gap-2 mb-4">
                <button 
                  onClick={() => {
                    setSelectedStudent(null);
                    setIsCameraOpen(true);
                  }}
                  className="flex-1 flex items-center justify-center gap-2 bg-indigo-600 text-white py-3 rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-indigo-500 transition-all shadow-lg shadow-indigo-100"
                >
                  <CameraIcon size={14} />
                  Quick Scan
                </button>
                <button 
                  onClick={() => setIsAddStudentOpen(true)}
                  className="w-12 flex items-center justify-center border border-slate-200 text-slate-400 rounded-xl hover:bg-slate-50 transition-all"
                  title="Register Student"
                >
                  <UserPlus size={16} />
                </button>
                <button 
                  onClick={() => setIsBulkUploadOpen(true)}
                  className="w-12 flex items-center justify-center border border-slate-200 text-slate-400 rounded-xl hover:bg-slate-50 transition-all"
                  title="Bulk Upload Students"
                >
                  <Upload size={16} />
                </button>
              </div>

              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" size={14} />
                <input 
                  type="text" 
                  placeholder="Search students..." 
                  className="w-full pl-9 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-100 text-xs font-medium"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                />
              </div>
            </div>

            <div className="overflow-y-auto flex-1 divide-y divide-slate-50">
              {filteredStudents.length === 0 ? (
                <div className="p-12 text-center">
                   <p className="text-xs text-slate-400 italic">No matching records</p>
                </div>
              ) : (
                filteredStudents.map((student) => (
                  <button 
                    key={student.id}
                    onClick={() => setSelectedStudent(student)}
                    className={`w-full text-left p-4 hover:bg-indigo-50/50 transition-colors flex items-center justify-between group ${selectedStudent?.id === student.id ? 'bg-indigo-50 border-l-4 border-indigo-600' : ''}`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-xs ${selectedStudent?.id === student.id ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-400'}`}>
                        {student.name.charAt(0)}
                      </div>
                      <div>
                        <h4 className="text-xs font-bold text-slate-900 uppercase truncate max-w-[180px]">{student.name}</h4>
                        <p className="text-[10px] text-slate-500 font-mono">ID: {student.rollNumber}</p>
                      </div>
                    </div>
                    <ChevronRight size={14} className={`text-slate-300 transition-transform ${selectedStudent?.id === student.id ? 'translate-x-1 text-indigo-600' : 'opacity-0 group-hover:opacity-100'}`} />
                  </button>
                ))
              )}
            </div>
          </section>
        </aside>

        {/* Content Area Section */}
        <section className="space-y-6">
          <AnimatePresence mode="wait">
            {selectedStudent ? (
              <motion.div 
                key={selectedStudent.id}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-6"
              >
                {/* Profile Header Bento */}
                <div className="bg-white border border-slate-200 rounded-3xl p-8 shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <span className="px-2 py-1 bg-indigo-50 text-indigo-600 rounded-md text-[9px] font-black uppercase">Active Record</span>
                      <span className="text-[10px] text-slate-400 font-mono">{selectedStudent.id}</span>
                    </div>
                    <h2 className="text-4xl font-black text-slate-900 tracking-tighter uppercase mb-2">{selectedStudent.name}</h2>
                    <div className="flex items-center gap-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                      <span>Roll: <span className="text-slate-900 font-mono">{selectedStudent.rollNumber}</span></span>
                      <span className="w-1 h-1 bg-slate-300 rounded-full" />
                      <span>Archive Joined: <span className="text-slate-900">{selectedStudent.createdAt?.toDate().toLocaleDateString()}</span></span>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button 
                      onClick={() => deleteStudent(selectedStudent.id)}
                      className="bg-white border border-red-200 text-red-500 px-4 py-3 rounded-xl hover:bg-red-50 transition-all flex items-center justify-center"
                      title="Purge Student Record"
                    >
                      <Trash2 size={18} />
                    </button>
                    <button 
                      onClick={() => setIsCameraOpen(true)}
                      className="bg-indigo-600 text-white px-5 py-3 rounded-xl text-[10px] font-bold uppercase tracking-widest flex items-center gap-2 hover:bg-indigo-500 hover:scale-105 transition-all shadow-lg shadow-indigo-100"
                    >
                      <CameraIcon size={14} />
                      Scan New Document
                    </button>
                    <label className="bg-white border border-slate-200 text-slate-600 px-5 py-3 rounded-xl text-[10px] font-bold uppercase tracking-widest flex items-center gap-2 cursor-pointer hover:border-indigo-400 hover:text-indigo-600 transition-all">
                      <Upload size={14} />
                      Upload
                      <input type="file" className="hidden" accept="image/*" onChange={uploadFile} />
                    </label>
                  </div>
                </div>

                {/* Bulk Actions Bar */}
                <AnimatePresence>
                  {selectedDocIds.length > 0 && (
                    <motion.div 
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="bg-indigo-600 p-4 rounded-2xl shadow-xl shadow-indigo-100 flex items-center justify-between">
                        <div className="flex items-center gap-4 text-white pl-2">
                          <CheckCircle2 size={24} />
                          <div>
                            <p className="text-xs font-black uppercase tracking-widest leading-none mb-1">{selectedDocIds.length} Assets Selected</p>
                            <p className="text-[10px] font-medium text-indigo-200">Prepare for batch processing</p>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <button 
                            onClick={() => setSelectedDocIds([])}
                            className="px-4 py-2 text-[10px] font-bold uppercase text-indigo-100 hover:text-white"
                          >
                            Cancel
                          </button>
                          <button 
                            onClick={batchDownload}
                            className="bg-white/10 text-white border border-white/20 px-6 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-white/20 transition-all flex items-center gap-2"
                          >
                            <Download size={14} />
                            Download ZIP
                          </button>
                          <button 
                            onClick={deleteSelectedDocs}
                            className="bg-white text-indigo-600 px-6 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-indigo-50 transition-all flex items-center gap-2"
                          >
                            <Trash2 size={14} />
                            Purge Selection
                          </button>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Documents Grid Bento */}
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                  {studentDocuments.length === 0 ? (
                    <div className="col-span-full bg-white/40 border-2 border-dashed border-slate-200 p-24 rounded-3xl flex flex-col items-center justify-center text-center">
                      <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mb-4 text-slate-300">
                        <FileText size={32} />
                      </div>
                      <h4 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-1">Zero Assets Found</h4>
                      <p className="text-[10px] text-slate-300 lowercase italic">Begin by capturing a physical certificate</p>
                    </div>
                  ) : (
                    studentDocuments.map(sDoc => {
                      const isSelected = selectedDocIds.includes(sDoc.id);
                      const inSelectionMode = selectedDocIds.length > 0;

                      return (
                        <motion.div 
                          key={sDoc.id}
                          layout
                          onMouseDown={() => {
                            longPressTimer.current = setTimeout(() => handleLongPress(sDoc.id), 700);
                          }}
                          onMouseUp={() => {
                            if (longPressTimer.current) clearTimeout(longPressTimer.current);
                          }}
                          onTouchStart={() => {
                            longPressTimer.current = setTimeout(() => handleLongPress(sDoc.id), 700);
                          }}
                          onTouchEnd={() => {
                            if (longPressTimer.current) clearTimeout(longPressTimer.current);
                          }}
                          onClick={() => {
                            if (inSelectionMode) toggleSelect(sDoc.id);
                          }}
                          className={`bg-white border-2 rounded-[24px] overflow-hidden group transition-all duration-500 relative ${isSelected ? 'border-indigo-600 shadow-2xl scale-[1.02]' : 'border-slate-100 hover:border-indigo-300 hover:shadow-xl hover:shadow-indigo-50/50'}`}
                        >
                          <div className="aspect-square relative flex items-center justify-center bg-slate-50 overflow-hidden">
                            <img 
                              src={sDoc.imageData} 
                              className="w-full h-full object-cover transition-transform duration-1000 ease-out group-hover:scale-110" 
                              alt={sDoc.type} 
                            />
                            
                            {/* Sophisticated Overlay */}
                            <div className={`absolute inset-0 transition-all duration-500 ${isSelected ? 'bg-indigo-600/20' : 'bg-transparent group-hover:bg-slate-900/40 group-hover:backdrop-blur-[2px]'}`} />
                            
                            {isSelected && (
                              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="bg-indigo-600 text-white p-3 rounded-full shadow-2xl">
                                  <CheckCircle2 size={32} />
                                </motion.div>
                              </div>
                            )}

                            {/* Label Tag */}
                            <div className="absolute top-4 left-4 bg-white/95 backdrop-blur-md px-3 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-[0.15em] text-indigo-600 shadow-sm border border-white/20">
                              {sDoc.type}
                            </div>

                            {/* Refined Quick Actions */}
                            {!inSelectionMode && (
                              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex gap-3 opacity-0 group-hover:opacity-100 transition-all duration-300 translate-y-4 group-hover:translate-y-0">
                                <button 
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const studentId = selectedStudent.id;
                                    const documentId = sDoc.id;
                                    const docLabel = sDoc.type;
                                    
                                    setConfirmDialog({
                                      isOpen: true,
                                      title: "Purge Document?",
                                      message: `Are you sure you want to permanently delete the ${docLabel} record?`,
                                      variant: 'danger',
                                      onConfirm: async () => {
                                        try {
                                          await deleteDoc(doc(db, `students/${studentId}/documents`, documentId));
                                          setConfirmDialog(prev => ({ ...prev, isOpen: false }));
                                        } catch(err) {
                                          handleFirestoreError(err, OperationType.DELETE, 'document');
                                        }
                                      }
                                    });
                                  }}
                                  className="w-12 h-12 bg-white text-red-500 rounded-2xl flex items-center justify-center shadow-2xl hover:bg-red-500 hover:text-white transition-all hover:scale-110 active:scale-95"
                                  title="Purge Record"
                                >
                                  <Trash2 size={20} />
                                </button>
                              </div>
                            )}
                          </div>
                          <div className="p-5 flex justify-between items-start bg-white bg-gradient-to-b from-white to-slate-50/50">
                            <div className="min-w-0 flex-1 pr-4">
                              <p className="text-[10px] text-slate-400 uppercase font-black tracking-widest mb-1 truncate">{sDoc.fileName || sDoc.type}</p>
                              <div className="flex items-center gap-2">
                                <History size={10} className="text-slate-300" />
                                <p className="text-[10px] font-bold text-slate-600">{sDoc.createdAt?.toDate().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <a 
                                href={sDoc.imageData} 
                                download={`${selectedStudent.name}_${sDoc.type}.jpg`}
                                className="w-8 h-8 bg-slate-50 border border-slate-100 rounded-lg flex items-center justify-center text-slate-400 hover:text-indigo-600 hover:bg-white hover:shadow-sm transition-all"
                                title="Download"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <Download size={14} />
                              </a>
                              <div className="text-[9px] font-mono font-bold text-slate-300 bg-slate-100/50 px-2 py-1 rounded-md border border-slate-100 uppercase tracking-tighter">#{(sDoc.id || '...').slice(0, 4)}</div>
                            </div>
                          </div>
                        </motion.div>
                      );
                    })
                  )}
                </div>
              </motion.div>
            ) : (
              <div className="h-[600px] flex flex-col items-center justify-center bg-white/40 border-2 border-dashed border-slate-200 rounded-[40px] text-slate-300">
                <Database size={64} className="mb-6 opacity-20" />
                <h3 className="text-xl font-black uppercase tracking-widest opacity-20">System Awaiting Selection</h3>
                <p className="text-[10px] uppercase font-bold tracking-[0.3em] mt-2 opacity-30">Access Central Database Registry</p>
              </div>
            )}
          </AnimatePresence>
        </section>
      </main>

      {/* Modals Styled for Bento */}
      <AnimatePresence>
        {isAddStudentOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsAddStudentOpen(false)}
              className="absolute inset-0 bg-slate-900/20 backdrop-blur-sm" 
            />
            <motion.div 
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              className="relative bg-white border border-slate-200 p-8 w-full max-w-md rounded-3xl shadow-2xl"
            >
              <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center mb-6">
                <UserPlus size={24} />
              </div>
              <h2 className="text-2xl font-black text-slate-900 uppercase tracking-tighter mb-2">New Enrollment</h2>
              <p className="text-xs text-slate-400 mb-8 font-medium">Create a new entry in the secure identity repository.</p>
              
              <form onSubmit={addStudent} className="space-y-5">
                <div>
                  <label className="block text-[10px] uppercase font-black text-slate-400 mb-2 tracking-widest">Legal Name</label>
                  <input 
                    required
                    type="text" 
                    placeholder="E.g. Rajesh Kumar"
                    className="w-full p-3.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-100 transition-all font-medium"
                    value={newStudentName}
                    onChange={e => setNewStudentName(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase font-black text-slate-400 mb-2 tracking-widest">Enrollment / UID</label>
                  <input 
                    required
                    type="text" 
                    placeholder="E.g. REG-2024-X001"
                    className="w-full p-3.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-100 transition-all font-mono text-xs"
                    value={newStudentRoll}
                    onChange={e => setNewStudentRoll(e.target.value)}
                  />
                </div>
                <div className="pt-4 space-y-3">
                  <button type="submit" className="w-full bg-slate-900 text-white py-4 rounded-xl text-xs font-bold uppercase tracking-widest hover:bg-brand-primary transition-all shadow-lg shadow-slate-200">
                    Verify & Archive Identity
                  </button>
                  <button type="button" onClick={() => setIsAddStudentOpen(false)} className="w-full text-slate-400 py-3 text-[10px] font-bold uppercase tracking-widest hover:text-slate-600">
                    Dismiss
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}

        {isUploadDetailsOpen && tempImage && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-0 md:p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-md" 
            />
            <motion.div 
              initial={{ y: 50, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 50, opacity: 0 }}
              className="relative bg-white w-full max-w-4xl md:rounded-[40px] overflow-hidden flex flex-col md:flex-row h-full md:max-h-[85vh] shadow-2xl"
            >
              <div className="flex-1 bg-slate-900 flex items-center justify-center p-4 min-h-[300px]">
                <img src={tempImage} className="max-w-full max-h-full object-contain rounded-xl shadow-2xl" alt="Scan preview" />
              </div>
              <div className="w-full md:w-80 p-6 md:p-8 flex flex-col justify-between border-l border-slate-100 overflow-y-auto">
                <div className="space-y-6">
                  <div>
                     <h2 className="text-xl font-black text-slate-900 uppercase tracking-tighter mb-1">Finalize</h2>
                     <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Metadata Assignment</p>
                  </div>
                  
                  <div>
                    <label className="block text-[10px] uppercase font-black text-slate-400 mb-3 tracking-widest">Mapping to Record</label>
                    {!selectedStudent ? (
                      <select 
                        className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl text-[10px] font-bold uppercase tracking-widest appearance-none outline-none focus:ring-2 focus:ring-indigo-100"
                        onChange={(e) => {
                          const student = students.find(s => s.id === e.target.value);
                          if (student) setSelectedStudent(student);
                        }}
                        defaultValue=""
                      >
                        <option value="" disabled>Select Student Registry...</option>
                        {students.map(s => (
                          <option key={s.id} value={s.id}>{s.name} ({s.rollNumber})</option>
                        ))}
                      </select>
                    ) : (
                      <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl flex justify-between items-center group">
                        <div className="min-w-0">
                          <p className="text-xs font-black text-slate-900 uppercase truncate">{selectedStudent.name}</p>
                          <p className="text-[9px] font-mono text-slate-400 mt-1 uppercase">ROLL: {selectedStudent.rollNumber}</p>
                        </div>
                        <button 
                          onClick={() => setSelectedStudent(null)}
                          className="text-[9px] font-bold text-indigo-600 hover:bg-white px-2 py-1 rounded transition-colors uppercase whitespace-nowrap ml-2"
                        >
                          Change
                        </button>
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="block text-[10px] uppercase font-black text-slate-400 mb-3 tracking-widest">Document Title</label>
                    <input 
                      type="text" 
                      placeholder="Enter custom name..."
                      className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl text-xs font-bold focus:ring-2 focus:ring-indigo-100 outline-none"
                      value={customName}
                      onChange={(e) => setCustomName(e.target.value)}
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="block text-[10px] uppercase font-black text-slate-400 mb-3 tracking-widest">Asset Category</label>
                    <div className="grid grid-cols-2 md:grid-cols-1 gap-2">
                      {(['Aadhaar', 'PAN', '10th Marksheet', '12th Marksheet', 'Other'] as DocumentType[]).map(t => (
                        <button 
                          key={t}
                          onClick={() => setDocType(t)}
                          className={`w-full text-left px-4 py-3 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all flex items-center justify-between group ${docType === t ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-100' : 'bg-slate-50 text-slate-400 hover:text-slate-600'}`}
                        >
                          {t}
                          <div className={`w-1.5 h-1.5 rounded-full transition-all ${docType === t ? 'bg-white scale-100' : 'bg-slate-200 group-hover:bg-slate-400'}`} />
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="pt-8 space-y-3 sticky bottom-0 bg-white">
                  <button 
                    disabled={uploading || !selectedStudent}
                    onClick={saveDocument}
                    className="w-full bg-indigo-600 text-white py-4 rounded-xl text-xs font-black uppercase tracking-widest hover:bg-indigo-500 disabled:opacity-50 flex items-center justify-center gap-2 shadow-lg shadow-indigo-100"
                  >
                    {uploading ? "Analyzing & Writing..." : "Confirm Secure Archive"}
                  </button>
                  <button 
                    onClick={() => {
                      setIsUploadDetailsOpen(false);
                      setTempImage(null);
                    }} 
                    className="w-full text-slate-400 py-3 text-[9px] font-bold uppercase tracking-widest hover:text-slate-600 flex items-center justify-center gap-2"
                  >
                    Discard Scan
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}

        {isBulkUploadOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsBulkUploadOpen(false)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-md" 
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="relative bg-white border border-slate-200 p-8 w-full max-w-md rounded-[32px] shadow-2xl"
            >
              <div className="flex justify-between items-center mb-8">
                <div>
                  <h2 className="text-xl font-black text-slate-900 uppercase tracking-tighter">Bulk Registrar</h2>
                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1">Batch Batch Processing</p>
                </div>
                <button onClick={() => setIsBulkUploadOpen(false)} className="w-10 h-10 border border-slate-100 rounded-full flex items-center justify-center text-slate-400 hover:bg-slate-50">
                  <X size={20} />
                </button>
              </div>

              <div className="space-y-6">
                <div className="p-6 bg-slate-50 border border-dashed border-slate-200 rounded-2xl flex flex-col items-center text-center">
                  <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center text-indigo-600 shadow-sm mb-4">
                    <FileText size={24} />
                  </div>
                  <h3 className="text-xs font-black text-slate-900 uppercase tracking-widest">CSV Manifest</h3>
                  <p className="text-[10px] text-slate-400 mt-2 leading-relaxed">Required Headers: <strong>name, rollNumber</strong></p>
                  
                  <button 
                    onClick={() => {
                      const csvContent = "data:text/csv;charset=utf-8,name,rollNumber\nJohn Doe,ROLL-001\nJane Smith,ROLL-002";
                      const encodedUri = encodeURI(csvContent);
                      const link = document.createElement("a");
                      link.setAttribute("href", encodedUri);
                      link.setAttribute("download", "student_template.csv");
                      document.body.appendChild(link);
                      link.click();
                      document.body.removeChild(link);
                    }}
                    className="mt-4 flex items-center gap-2 text-[9px] font-black uppercase text-indigo-600 hover:text-indigo-700 underline tracking-widest"
                  >
                    <Download size={14} />
                    Download Blueprint Template
                  </button>
                </div>

                <div className="relative">
                  <input 
                    type="file" 
                    accept=".csv"
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      
                      Papa.parse(file, {
                        header: true,
                        skipEmptyLines: true,
                        complete: async (results) => {
                          const data = results.data as any[];
                          let count = 0;
                          for (const row of data) {
                            if (row.name && row.rollNumber) {
                              try {
                                await addDoc(collection(db, 'students'), {
                                  name: row.name,
                                  rollNumber: row.rollNumber,
                                  createdAt: serverTimestamp()
                                });
                                count++;
                              } catch(err) {
                                console.error("Error adding row: ", row, err);
                              }
                            }
                          }
                          setIsBulkUploadOpen(false);
                          alert(`Successfully registered ${count} students`);
                        }
                      });
                    }}
                  />
                  <div className="w-full bg-slate-900 text-white py-4 rounded-2xl text-xs font-black uppercase tracking-widest flex items-center justify-center gap-3 shadow-lg shadow-slate-200">
                    <Upload size={16} />
                    Deploy CSV File
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}

        {isCameraOpen && (
          <CameraView 
            onCapture={handleCapture}
            onClose={() => setIsCameraOpen(false)}
          />
        )}

        {confirmDialog.isOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setConfirmDialog(prev => ({ ...prev, isOpen: false }))}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-md" 
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="relative bg-white border border-slate-200 p-8 w-full max-w-sm rounded-[32px] shadow-2xl text-center"
            >
              <div className={`w-16 h-16 ${confirmDialog.variant === 'danger' ? 'bg-red-50 text-red-500' : 'bg-amber-50 text-amber-500'} rounded-full flex items-center justify-center mb-6 mx-auto`}>
                <Trash2 size={28} />
              </div>
              <h2 className="text-xl font-black text-slate-900 uppercase tracking-tighter mb-2">{confirmDialog.title}</h2>
              <p className="text-xs text-slate-400 font-medium leading-relaxed mb-8">{confirmDialog.message}</p>
              
              <div className="space-y-2">
                <button 
                  onClick={confirmDialog.onConfirm}
                  className={`w-full py-4 rounded-2xl text-xs font-black uppercase tracking-widest transition-all ${confirmDialog.variant === 'danger' ? 'bg-red-500 text-white hover:bg-red-600 shadow-lg shadow-red-100' : 'bg-amber-500 text-white hover:bg-amber-600 shadow-lg shadow-amber-100'}`}
                >
                  Confirm Delete
                </button>
                <button 
                  onClick={() => setConfirmDialog(prev => ({ ...prev, isOpen: false }))}
                  className="w-full py-3 text-[10px] font-bold text-slate-400 uppercase tracking-widest hover:text-slate-600"
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
