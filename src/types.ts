export interface Student {
  id: string;
  name: string;
  rollNumber: string;
  email?: string;
  creatorId: string;
  createdAt: any;
}

export type DocumentType = 'Aadhaar' | 'PAN' | '10th Marksheet' | '12th Marksheet' | 'Other';

export interface StudentDocument {
  id: string;
  studentId: string;
  type: DocumentType;
  imageData: string; // Base64
  fileName?: string;
  mimeType?: string;
  createdAt: any;
}
