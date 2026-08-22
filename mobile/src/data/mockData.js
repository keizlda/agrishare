// Mock data for the farmer-facing mobile app. Represents the logged-in
// farmer's own scoped view (profile, their distribution history, commodities
// available in their barangay, announcements, crop validation).

export const currentFarmer = {
  farmerId: "F-2024-0001",
  firstName: "Juan",
  lastName: "Dela Cruz",
  rsbsaNo: "1234-5678-9101-1121",
  barangay: "Langapud",
  contactNo: "0917 129 4567",
  farmSize: "1.50 ha",
  primaryCommodity: "Rice",
  validationStatus: "Validated",
};

export const homeOverview = {
  totalDistributions: 8,
  totalQuantityReceived: 12400,
  activePrograms: 3,
  upcomingSchedules: 2,
};

// "Scheduled" distributions haven't happened yet (Upcoming tab); Completed
// and Ongoing are grouped as My Distributions / History.
export const distributions = [
  { id: "DST-1", program: "RCEF Seed Distribution", date: "2024-05-20", time: "9:00 AM", venue: "San Isidro", item: "Rice Seeds (NSIC Rc222)", quantity: 2400, unit: "kg", farmersReceived: 580, status: "Completed" },
  { id: "DST-2", program: "Corn Seeds Distribution", date: "2024-05-18", time: "9:30 AM", venue: "Villa Verde", item: "Corn Seeds", quantity: 1960, unit: "kg", farmersReceived: 420, status: "Completed" },
  { id: "DST-3", program: "Fertilizer Distribution", date: "2024-05-10", time: "10:00 AM", venue: "San Isidro", item: "Fertilizer", quantity: 2200, unit: "kg", farmersReceived: 350, status: "Ongoing" },
  { id: "DST-4", program: "Vegetable Seeds Distribution", date: "2024-06-05", time: "9:00 AM", venue: "Barangay Hall", item: "Vegetable Seeds", quantity: 1500, unit: "kg", farmersReceived: 0, status: "Scheduled" },
];

export const commodities = [
  { id: "COM-1", name: "Rice Seeds (NSIC Rc222)", category: "Seed", available: 2400, unit: "kg", stockLevel: "In Stock" },
  { id: "COM-2", name: "Corn Seeds", category: "Seed", available: 1960, unit: "kg", stockLevel: "In Stock" },
  { id: "COM-3", name: "Fertilizer", category: "Agrochemical", available: 2200, unit: "kg", stockLevel: "In Stock" },
  { id: "COM-4", name: "Pesticide", category: "Agrochemical", available: 850, unit: "kg", stockLevel: "Low Stock" },
  { id: "COM-5", name: "Herbicide", category: "Agrochemical", available: 450, unit: "kg", stockLevel: "Low Stock" },
  { id: "COM-6", name: "Farm Tools", category: "Equipment", available: 150, unit: "sets", stockLevel: "In Stock" },
  { id: "COM-7", name: "Fuel", category: "Other", available: 300, unit: "L", stockLevel: "In Stock" },
  { id: "COM-8", name: "Organic Soil Conditioner", category: "Other", available: 600, unit: "kg", stockLevel: "Low Stock" },
];

export const announcements = [
  { id: "A-1", title: "RCEF Seed Distribution on May 20", body: "This is to inform all farmers that RCEF seed distribution will be held on May 20, 2024 at the barangay hall.", date: "2024-05-20", time: "8:30 AM", isNew: true, read: false, archived: false },
  { id: "A-2", title: "Training on Sustainable Farming Practices", body: "A training session on sustainable farming practices will be conducted on May 25, 2024. All interested farmers are encouraged to participate.", date: "2024-05-18", time: "2:15 PM", isNew: false, read: false, archived: false },
  { id: "A-3", title: "Water Supply Maintenance", body: "Please be advised that there will be a scheduled maintenance of the irrigation system on May 22, 2024. Thank you for your cooperation.", date: "2024-05-16", time: "10:00 AM", isNew: false, read: true, archived: false },
  { id: "A-4", title: "Fertilizer Availability Update", body: "Additional fertilizer stocks are now available. Please coordinate with your barangay coordinator for your requirements.", date: "2024-05-15", time: "9:45 AM", isNew: false, read: true, archived: false },
  { id: "A-5", title: "Pest Management Advisory", body: "Monitor your crops regularly and follow the recommended pest control measures. Contact your agri technician for assistance.", date: "2024-05-13", time: "4:30 PM", isNew: false, read: true, archived: false },
  { id: "A-6", title: "Upcoming Corn Seeds Distribution", body: "Corn seeds distribution will be on May 18, 2024 at the barangay hall.", date: "2024-05-10", time: "11:00 AM", isNew: false, read: true, archived: true },
];

// Farmer's own commodity requests (Use Case: "Send Request to FA").
// Flow: Pending (submitted, awaiting FA President) -> Forwarded (FA sent to
// MAO) -> Approved/Rejected (MAO decision). REQ-1 mirrors the web app's
// REQ-2024-0001 so both sides of the same demo story stay consistent.
export const myRequests = [
  { id: "REQ-1", commodity: "Rice Seeds (NSIC Rc222)", quantity: 50, unit: "kg", reason: "For upcoming wet season planting on additional farm area.", requestDate: "2024-05-21", status: "Pending" },
  { id: "REQ-0", commodity: "Fertilizer", quantity: 20, unit: "kg", reason: "Needed for second cropping cycle top-dressing.", requestDate: "2024-04-30", status: "Approved" },
];

export const cropValidationSample = {
  farmerName: "Juan Dela Cruz",
  rsbsaNo: "1234-5678-9101-1121",
  barangay: "Langapud",
  commodityReceived: "Hybrid Rice Seeds",
  distributionDate: "2024-05-15",
  status: "PENDING VALIDATION",
  gps: { latitude: "7.245123° N", longitude: "123.654321° E", capturedAt: "2024-05-22, 10:30 AM", accuracy: "±5.2 meters", accuracyRating: "Good" },
};
