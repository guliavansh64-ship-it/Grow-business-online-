/**
 * Demo seed data.
 *
 * Creates 4 vendors (in different lifecycle states), 28 products, ~70 orders
 * spread over the last 60 days, plus deposits / withdrawals / notifications so
 * every screen in the frontend has real content on first run.
 *
 *   npm run seed   → seed only if the DB is empty
 *   npm run reset  → wipe and re-seed
 */
const fs = require('fs');
const db = require('./db');
const config = require('./config');
const { hashPassword, slugify } = require('./security');
const { toPaise, commissionSplit, daysAgo, hoursFromNow, TRACKING_STEPS } = require('./domain');

const AVATAR_COLORS = ['#6D5EF6', '#0EA5E9', '#16A34A', '#F59E0B', '#EC4899', '#8B5CF6', '#14B8A6', '#F97316'];

const rnd = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = (arr) => arr[rnd(0, arr.length - 1)];

/* ------------------------------------------------------------------ catalogue */

const VENDORS = [
  {
    slug: 'techmart',
    name: 'TechMart Electronics',
    legalName: 'TechMart Retail Pvt Ltd',
    ownerName: 'Rahul Sharma',
    email: 'vendor@growbusinessonline.com',
    password: 'Vendor@123',
    phone: '+91 98123 45678',
    tagline: 'Gadgets, audio and computing gear — delivered across India.',
    description:
      'TechMart is a Bengaluru based electronics store specialising in smartphones, audio gear, laptops and everyday accessories. Every product is brand sealed with an India warranty and ships within 24 hours.',
    businessType: 'Electronics Retail',
    address: '42, MG Road, Level 2',
    city: 'Bengaluru',
    state: 'Karnataka',
    country: 'India',
    pincode: '560001',
    status: 'active',
    palette: ['#4F46E5', '#0EA5E9'],
    art: 'techmart',
    rating: 4.7,
    since: 210,
  },
  {
    slug: 'stylehub',
    name: 'StyleHub Fashion',
    legalName: 'StyleHub Apparel LLP',
    ownerName: 'Priya Nair',
    email: 'priya@stylehub.in',
    password: 'Vendor@123',
    phone: '+91 99887 66554',
    tagline: 'Everyday fashion for men and women at honest prices.',
    description:
      'StyleHub designs and ships comfortable everyday fashion — kurtas, denim, tees, blazers and footwear — straight from our Jaipur studio. Free delivery above ₹999 and easy 7-day returns.',
    businessType: 'Fashion & Apparel',
    address: '12, Fashion Lane, Vaishali Nagar',
    city: 'Jaipur',
    state: 'Rajasthan',
    country: 'India',
    pincode: '302021',
    status: 'active',
    palette: ['#DB2777', '#F59E0B'],
    art: 'stylehub',
    rating: 4.5,
    since: 140,
  },
  {
    slug: 'freshkart',
    name: 'FreshKart Organics',
    legalName: 'FreshKart Foods',
    ownerName: 'Aman Verma',
    email: 'aman@freshkart.in',
    password: 'Vendor@123',
    phone: '+91 90000 11122',
    tagline: 'Farm fresh organic staples delivered weekly.',
    description: 'Cold pressed oils, raw honey and organic grains sourced directly from farms in Haryana.',
    businessType: 'Grocery & Organics',
    address: 'Plot 8, Sector 14',
    city: 'Jhajjar',
    state: 'Haryana',
    country: 'India',
    pincode: '124103',
    status: 'pending_deposit',
    palette: ['#16A34A', '#84CC16'],
    art: 'freshkart',
    rating: 0,
    since: 2,
  },
  {
    slug: 'homely',
    name: 'Homely Decor',
    legalName: 'Homely Interiors',
    ownerName: 'Sneha Kulkarni',
    email: 'sneha@homely.in',
    password: 'Vendor@123',
    phone: '+91 91234 56780',
    tagline: 'Handcrafted decor for modern Indian homes.',
    description: 'Ceramics, wall art and soft furnishings made by artisans across Pune.',
    businessType: 'Home & Living',
    address: '7, Koregaon Park',
    city: 'Pune',
    state: 'Maharashtra',
    country: 'India',
    pincode: '411001',
    status: 'pending_activation',
    palette: ['#F97316', '#EC4899'],
    art: 'homely',
    rating: 0,
    since: 1,
  },
];

const CATEGORIES = {
  techmart: ['Mobiles', 'Laptops', 'Audio', 'Wearables', 'Cameras', 'Accessories', 'Computers'],
  stylehub: ['Clothing', 'Shoes', 'Bags', 'Accessories'],
  freshkart: ['Grocery', 'Organic'],
  homely: ['Decor', 'Kitchen'],
};

// [name, category, glyph, price, mrp, stock, rating, reviews, gradientIndex]
const PRODUCTS = {
  techmart: [
    ['Aurora X5 Smartphone', 'Mobiles', 'phone', 18999, 24999, 42, 4.6, 318, 0],
    ['Nova Pro 5G', 'Mobiles', 'phone', 32499, 39999, 18, 4.8, 512, 1],
    ['Pulse Mini Compact', 'Mobiles', 'phone', 9499, 12999, 63, 4.2, 141, 2],
    ['Zenith Laptop 14"', 'Laptops', 'laptop', 54990, 69990, 12, 4.7, 96, 3],
    ['AeroBook Air 13', 'Laptops', 'laptop', 78990, 89990, 7, 4.9, 64, 4],
    ['BassDrop ANC Headphones', 'Audio', 'headphones', 4999, 7999, 88, 4.5, 421, 5],
    ['SoundPod Mini Speaker', 'Audio', 'speaker', 2499, 3999, 120, 4.3, 233, 6],
    ['TrueBuds Air 2', 'Audio', 'earbuds', 3299, 4999, 156, 4.4, 388, 7],
    ['Chrono Smart Watch', 'Wearables', 'watch', 6499, 9999, 54, 4.6, 205, 8],
    ['FitBand Active', 'Wearables', 'band', 1999, 2999, 210, 4.1, 176, 9],
    ['ProShot DSLR 24MP', 'Cameras', 'camera', 46990, 54990, 6, 4.8, 42, 10],
    ['ActionCam 4K Pro', 'Cameras', 'camera', 12999, 16999, 22, 4.4, 88, 11],
    ['65W GaN Fast Charger', 'Accessories', 'charger', 1499, 2499, 340, 4.5, 289, 12],
    ['Braided USB-C Cable 1.5m', 'Accessories', 'cable', 399, 699, 500, 4.3, 604, 13],
    ['MagSafe Power Bank 10K', 'Accessories', 'battery', 2799, 3999, 96, 4.4, 152, 0],
    ['UltraWide 27" Monitor', 'Computers', 'monitor', 21990, 27990, 14, 4.7, 73, 1],
    ['Mechanical Keyboard RGB', 'Computers', 'keyboard', 3999, 5999, 61, 4.5, 198, 2],
    ['Wireless Ergo Mouse', 'Computers', 'mouse', 1299, 1999, 143, 4.2, 221, 3],
  ],
  stylehub: [
    ['Classic Cotton Kurta', 'Clothing', 'shirt', 1299, 1999, 74, 4.4, 132, 4],
    ['Slim Fit Denim Jeans', 'Clothing', 'jeans', 1799, 2999, 58, 4.3, 208, 5],
    ['Oversized Graphic Tee', 'Clothing', 'shirt', 699, 1199, 190, 4.5, 341, 6],
    ['Wool Blend Blazer', 'Clothing', 'blazer', 3999, 5999, 21, 4.7, 47, 7],
    ['Runner Pro Sneakers', 'Shoes', 'shoe', 2999, 4499, 83, 4.6, 264, 8],
    ['Leather Formal Shoes', 'Shoes', 'shoe', 4499, 6999, 34, 4.5, 91, 9],
    ['Canvas Slip-Ons', 'Shoes', 'shoe', 1499, 2299, 112, 4.2, 176, 10],
    ['Minimalist Tote Bag', 'Bags', 'bag', 1599, 2499, 66, 4.4, 88, 11],
    ['Weekender Duffle', 'Bags', 'bag', 2799, 3999, 28, 4.6, 54, 12],
    ['Aviator Sunglasses', 'Accessories', 'glasses', 1899, 2999, 97, 4.3, 143, 13],
    ['Leather Belt Classic', 'Accessories', 'belt', 999, 1599, 140, 4.4, 118, 0],
  ],
  freshkart: [
    ['Organic Raw Honey 500g', 'Organic', 'jar', 449, 599, 80, 4.6, 12, 1],
    ['Cold Pressed Mustard Oil 1L', 'Grocery', 'bottle', 289, 350, 120, 4.5, 8, 2],
    ['Whole Wheat Atta 5kg', 'Grocery', 'bag', 349, 420, 60, 4.4, 5, 3],
  ],
  homely: [
    ['Terracotta Vase Set', 'Decor', 'vase', 1899, 2799, 24, 4.7, 3, 4],
    ['Handloom Cushion Covers', 'Decor', 'pillow', 899, 1399, 55, 4.5, 6, 5],
  ],
};

const GRADIENTS = [
  ['#6366F1', '#22D3EE'],
  ['#8B5CF6', '#EC4899'],
  ['#0EA5E9', '#34D399'],
  ['#F59E0B', '#EF4444'],
  ['#10B981', '#84CC16'],
  ['#F43F5E', '#FB923C'],
  ['#3B82F6', '#8B5CF6'],
  ['#14B8A6', '#0EA5E9'],
  ['#A855F7', '#6366F1'],
  ['#F97316', '#FBBF24'],
  ['#0F766E', '#22D3EE'],
  ['#BE185D', '#F472B6'],
  ['#1D4ED8', '#60A5FA'],
  ['#065F46', '#4ADE80'],
];

const CITIES = [
  ['Mumbai', 'Maharashtra', '400001'],
  ['Delhi', 'Delhi', '110001'],
  ['Bengaluru', 'Karnataka', '560034'],
  ['Hyderabad', 'Telangana', '500032'],
  ['Chennai', 'Tamil Nadu', '600041'],
  ['Kolkata', 'West Bengal', '700019'],
  ['Pune', 'Maharashtra', '411045'],
  ['Jaipur', 'Rajasthan', '302017'],
  ['Ahmedabad', 'Gujarat', '380015'],
  ['Jhajjar', 'Haryana', '124103'],
];

const FIRST = ['Aarav', 'Diya', 'Vivaan', 'Ananya', 'Kabir', 'Ishita', 'Rohan', 'Meera', 'Arjun', 'Kavya', 'Aditya', 'Nisha', 'Yash', 'Pooja', 'Karan'];
const LAST = ['Patel', 'Reddy', 'Iyer', 'Khan', 'Singh', 'Mehta', 'Nair', 'Gupta', 'Joshi', 'Bose', 'Chauhan', 'Rao'];

const DESCRIPTIONS = [
  'Built for everyday use with a premium finish and a two year brand warranty. Ships in fully recyclable packaging.',
  'A best seller for three seasons running. Customers love the build quality, the finish and how it holds up over time.',
  'Designed in India, tested for Indian conditions. Includes everything in the box — no separate purchases needed.',
  'Lightweight, durable and easy to maintain. Backed by our 7 day replacement promise on manufacturing defects.',
];

const SPECS = {
  Mobiles: [['Display', '6.4" AMOLED 120Hz'], ['Battery', '5000 mAh'], ['Camera', '50MP + 8MP'], ['Warranty', '1 year']],
  Laptops: [['Processor', 'Octa core'], ['Memory', '16 GB'], ['Storage', '512 GB SSD'], ['Warranty', '2 years']],
  Audio: [['Driver', '40 mm dynamic'], ['Battery', '36 hours'], ['Bluetooth', '5.3'], ['Warranty', '1 year']],
  Wearables: [['Display', '1.43" AMOLED'], ['Battery', '14 days'], ['Water rating', '5 ATM'], ['Warranty', '1 year']],
  Cameras: [['Sensor', '24.2 MP APS-C'], ['Video', '4K 30fps'], ['Stabilisation', '5 axis'], ['Warranty', '2 years']],
  Accessories: [['Input', 'USB-C PD'], ['Output', '65 W max'], ['Cable', 'Braided 1.5 m'], ['Warranty', '6 months']],
  Computers: [['Panel', 'IPS 27"'], ['Refresh', '100 Hz'], ['Ports', 'HDMI + DP + USB-C'], ['Warranty', '3 years']],
  Clothing: [['Fabric', 'Combed cotton'], ['Fit', 'Regular'], ['Care', 'Machine wash cold'], ['Origin', 'India']],
  Shoes: [['Upper', 'Breathable mesh'], ['Sole', 'Rubber grip'], ['Closure', 'Lace up'], ['Origin', 'India']],
  Bags: [['Material', 'Vegan leather'], ['Capacity', '18 L'], ['Laptop sleeve', 'Yes'], ['Origin', 'India']],
  Grocery: [['Shelf life', '9 months'], ['Storage', 'Cool dry place'], ['Pack', 'Sealed'], ['FSSAI', 'Certified']],
  Organic: [['Shelf life', '12 months'], ['Storage', 'Cool dry place'], ['Pack', 'Glass'], ['FSSAI', 'Certified']],
  Decor: [['Material', 'Handcrafted'], ['Finish', 'Matte'], ['Care', 'Wipe clean'], ['Origin', 'India']],
};

/* ------------------------------------------------------------------ builders */

function buildVendors() {
  const vendors = [];
  const users = [];
  const categories = [];
  const products = [];
  const reviews = [];

  for (const seed of VENDORS) {
    const vendorId = `vnd_${seed.slug}`;
    const depositPaidAt = seed.status === 'pending_deposit' ? null : daysAgo(seed.since + 1);
    const activatedAt = seed.status === 'active' ? daysAgo(seed.since) : null;
    const activationDueAt =
      seed.slug === 'homely'
        ? hoursFromNow(config.devFastActivation ? 0.02 : 41.5)
        : activatedAt || null;

    vendors.push({
      id: vendorId,
      slug: seed.slug,
      name: seed.name,
      legalName: seed.legalName,
      ownerName: seed.ownerName,
      email: seed.email,
      phone: seed.phone,
      tagline: seed.tagline,
      description: seed.description,
      businessType: seed.businessType,
      address: seed.address,
      city: seed.city,
      state: seed.state,
      country: seed.country,
      pincode: seed.pincode,
      status: seed.status,
      logo: `/assets/images/logos/${seed.art}.svg`,
      favicon: `/assets/images/logos/${seed.art}.svg`,
      banner: `/assets/images/banners/${seed.art}.svg`,
      gallery: [`/assets/images/banners/${seed.art}.svg`],
      theme: {
        primary: seed.palette[0],
        secondary: seed.palette[1],
        accent: '#0EA5E9',
        mode: 'light',
        cardStyle: 'soft',
      },
      hours: { mon: '10:00-20:00', tue: '10:00-20:00', wed: '10:00-20:00', thu: '10:00-20:00', fri: '10:00-20:00', sat: '10:00-22:00', sun: 'Closed' },
      social: { instagram: `https://instagram.com/${seed.slug}`, facebook: '', whatsapp: seed.phone, youtube: '' },
      rating: seed.rating,
      reviewCount: 0,
      orderCount: 0,
      productCount: 0,
      joinedAt: daysAgo(seed.since + 2),
      depositPaidAt,
      activationDueAt,
      activatedAt,
      commissionPercent: config.commissionPercent,
      deliveryFeePaise: config.deliveryFeePaise,
      freeDeliveryAbovePaise: config.freeDeliveryAbovePaise,
      balance: { availablePaise: 0, pendingPaise: 0, earnedPaise: 0, commissionPaise: 0, withdrawnPaise: 0 },
      seo: { title: '', description: '', ogImage: '' },
      codEnabled: true,
      onlinePaymentEnabled: true,
      createdAt: daysAgo(seed.since + 2),
      updatedAt: daysAgo(seed.since),
    });

    const owner = {
      id: `usr_${seed.slug}`,
      name: seed.ownerName,
      email: seed.email,
      phone: seed.phone,
      passwordHash: hashPassword(seed.password),
      role: 'vendor',
      vendorId,
      emailVerified: seed.status !== 'pending_deposit',
      avatarColor: seed.palette[0],
      disabled: false,
      lastLoginAt: seed.status === 'active' ? daysAgo(0) : null,
      createdAt: daysAgo(seed.since + 2),
      updatedAt: daysAgo(seed.since),
    };
    users.push(owner);

    const cats = CATEGORIES[seed.slug] || [];
    cats.forEach((title, index) => {
      const id = `cat_${seed.slug}_${slugify(title)}`;
      categories.push({
        id,
        vendorId,
        name: title,
        slug: slugify(title),
        description: '',
        image: '',
        sortOrder: index,
        active: true,
        createdAt: daysAgo(seed.since),
      });
    });

    const items = PRODUCTS[seed.slug] || [];
    items.forEach((row, i) => {
      const [name, category, glyph, price, mrp, stock, rating, reviewCount, gi] = row;
      const id = `prd_${seed.slug}_${i + 1}`;
      const cat = categories.find((c) => c.vendorId === vendorId && c.name === category);
      products.push({
        id,
        vendorId,
        categoryId: cat ? cat.id : null,
        name,
        slug: slugify(`${seed.slug}-${name}`),
        sku: `${seed.slug.slice(0, 3).toUpperCase()}-${String(i + 1).padStart(4, '0')}`,
        shortDescription: pick(DESCRIPTIONS),
        description: `${pick(DESCRIPTIONS)} ${name} from ${seed.name} is one of our most requested products this season.`,
        specs: SPECS[category] || SPECS.Clothing,
        pricePaise: toPaise(price),
        mrpPaise: toPaise(mrp),
        discountPercent: Math.round(((mrp - price) / mrp) * 100),
        stock,
        lowStockAt: 10,
        unit: 'pcs',
        image: `/assets/images/products/${glyph}-${(gi % 4) + 1}.svg`,
        gallery: [
          `/assets/images/products/${glyph}-${(gi % 4) + 1}.svg`,
          `/assets/images/products/${glyph}-${((gi + 1) % 4) + 1}.svg`,
          `/assets/images/products/${glyph}-${((gi + 2) % 4) + 1}.svg`,
        ],
        rating,
        reviewCount,
        soldCount: Math.max(0, Math.round(reviewCount * 3.4)),
        status: stock === 0 ? 'out_of_stock' : 'active',
        featured: i < 4,
        tags: [category.toLowerCase(), seed.slug],
        seo: { title: '', description: '' },
        createdAt: daysAgo(seed.since - i),
        updatedAt: daysAgo(Math.max(0, seed.since - i - 5)),
      });

      for (let r = 0; r < Math.min(3, Math.round(reviewCount / 120)); r++) {
        reviews.push({
          id: `rev_${id}_${r}`,
          productId: id,
          vendorId,
          author: `${pick(FIRST)} ${pick(LAST)}`,
          rating: Math.max(3, Math.min(5, Math.round(rating + (r % 2 === 0 ? 0.4 : -0.4)))),
          title: r === 0 ? 'Exactly as described' : 'Good value',
          body:
            r === 0
              ? 'Delivered two days early and the packaging was solid. Would order again.'
              : 'Works well for the price. No complaints so far after a few weeks of use.',
          verified: true,
          createdAt: daysAgo(rnd(2, 40)),
        });
      }
    });
  }

  // roll up counters
  for (const v of vendors) {
    v.productCount = products.filter((p) => p.vendorId === v.id && p.status === 'active').length;
    v.reviewCount = reviews.filter((r) => r.vendorId === v.id).length;
    const rs = reviews.filter((r) => r.vendorId === v.id);
    if (rs.length && !v.rating) v.rating = Math.round((rs.reduce((a, r) => a + r.rating, 0) / rs.length) * 10) / 10;
  }

  return { vendors, users, categories, products, reviews };
}

function buildOrders({ vendors, products, users }) {
  const orders = [];
  const customers = [];
  const notifications = [];
  const ledger = [];

  const customerUser = {
    id: 'usr_customer',
    name: 'Ananya Gupta',
    email: 'customer@example.com',
    phone: '+91 98765 43210',
    passwordHash: hashPassword('Customer@123'),
    role: 'customer',
    vendorId: null,
    emailVerified: true,
    avatarColor: '#0EA5E9',
    disabled: false,
    createdAt: daysAgo(90),
    updatedAt: daysAgo(1),
  };
  users.push(customerUser);

  const admin = {
    id: 'usr_admin',
    name: 'Platform Admin',
    email: 'admin@growbusinessonline.com',
    phone: '+91 90000 00001',
    passwordHash: hashPassword('Admin@123'),
    role: 'super_admin',
    vendorId: null,
    emailVerified: true,
    avatarColor: '#0F172A',
    disabled: false,
    createdAt: daysAgo(400),
    updatedAt: daysAgo(0),
  };
  users.push(admin);

  let counter = 0;
  const customerMap = new Map();
  for (const vendor of vendors.filter((v) => v.status === 'active')) {
    const pool = products.filter((p) => p.vendorId === vendor.id);
    if (!pool.length) continue;
    const volume = vendor.slug === 'techmart' ? 46 : 24;

    for (let i = 0; i < volume; i++) {
      counter += 1;
      const ageDays = Math.floor((i / volume) * 58) + rnd(0, 1);
      const placedAt = daysAgo(ageDays);
      const isOwn = i % 11 === 0;
      const [city, state, pincode] = isOwn ? ['Bengaluru', 'Karnataka', '560034'] : pick(CITIES);
      const name = isOwn ? customerUser.name : `${pick(FIRST)} ${pick(LAST)}`;
      const email = isOwn ? customerUser.email : `${slugify(name)}${rnd(1, 99)}@mail.com`;
      const phone = isOwn ? customerUser.phone : `+91 9${rnd(100000000, 999999999)}`;

      const lines = [];
      const lineCount = rnd(1, 3);
      for (let l = 0; l < lineCount; l++) {
        const p = pick(pool);
        if (lines.some((x) => x.productId === p.id)) continue;
        const qty = rnd(1, 2);
        const gross = p.pricePaise * qty;
        lines.push({
          productId: p.id,
          name: p.name,
          image: p.image,
          unitPricePaise: p.pricePaise,
          unitMrpPaise: p.mrpPaise,
          qty,
          grossPaise: gross,
          discountPaise: (p.mrpPaise - p.pricePaise) * qty,
        });
      }
      if (!lines.length) continue;

      const subtotalPaise = lines.reduce((a, l) => a + l.grossPaise, 0);
      const discountPaise = lines.reduce((a, l) => a + l.discountPaise, 0);
      const netPaise = subtotalPaise - discountPaise;
      const deliveryFeePaise = netPaise >= config.freeDeliveryAbovePaise ? 0 : config.deliveryFeePaise;
      const totalPaise = netPaise + deliveryFeePaise;
      const split = commissionSplit(totalPaise);

      // Older orders settle, the newest ones stay in flight.
      let status;
      if (ageDays > 9) status = Math.random() < 0.08 ? 'cancelled' : 'delivered';
      else if (ageDays > 5) status = pick(['delivered', 'delivered', 'out_for_delivery', 'shipped']);
      else if (ageDays > 2) status = pick(['shipped', 'processing', 'confirmed']);
      else status = pick(['pending', 'confirmed', 'processing']);

      const paymentMethod = Math.random() < 0.62 ? 'upi' : 'cod';
      const paymentStatus = paymentMethod === 'cod' ? (status === 'delivered' ? 'paid' : 'pending') : status === 'pending' ? 'pending' : 'paid';
      const stepIndex = TRACKING_STEPS.indexOf(status);

      const timeline = [{ status: 'pending', at: placedAt, note: 'Order placed' }];
      if (stepIndex >= 1) timeline.push({ status: 'confirmed', at: new Date(new Date(placedAt).getTime() + 3600000).toISOString(), note: 'Confirmed by store' });
      if (stepIndex >= 2) timeline.push({ status: 'processing', at: new Date(new Date(placedAt).getTime() + 9 * 3600000).toISOString(), note: 'Packed and ready' });
      if (stepIndex >= 3) timeline.push({ status: 'shipped', at: new Date(new Date(placedAt).getTime() + 30 * 3600000).toISOString(), note: 'Handed to courier' });
      if (stepIndex >= 4) timeline.push({ status: 'out_for_delivery', at: new Date(new Date(placedAt).getTime() + 54 * 3600000).toISOString(), note: 'Out for delivery' });
      if (stepIndex >= 5) timeline.push({ status: 'delivered', at: new Date(new Date(placedAt).getTime() + 60 * 3600000).toISOString(), note: 'Delivered' });
      if (status === 'cancelled') timeline.push({ status: 'cancelled', at: new Date(new Date(placedAt).getTime() + 6 * 3600000).toISOString(), note: 'Cancelled by customer' });

      // Every order also creates/updates a customer record so the vendor CRM is populated.
      const cusKey = `${vendor.id}:${phone}`;
      if (!customerMap.has(cusKey)) {
        customerMap.set(cusKey, {
          id: `cus_${String(customerMap.size + 1).padStart(3, '0')}_${vendor.slug}`,
          userId: isOwn ? customerUser.id : null,
          vendorId: vendor.id,
          name,
          email,
          phone,
          city,
          orders: 0,
          spentPaise: 0,
          lastOrderAt: placedAt,
          createdAt: placedAt,
        });
        customers.push(customerMap.get(cusKey));
      }
      const cusRow = customerMap.get(cusKey);
      cusRow.orders += 1;
      cusRow.spentPaise += totalPaise;
      cusRow.lastOrderAt = placedAt;

      const order = {
        id: `ord_${String(counter).padStart(4, '0')}`,
        orderNumber: `GBO${new Date().getFullYear().toString().slice(2)}-${String(counter).padStart(5, '0')}`,
        vendorId: vendor.id,
        vendorSlug: vendor.slug,
        customerId: cusRow.id,
        userId: isOwn ? customerUser.id : null,
        customer: { name, email, phone, guest: !isOwn },
        shipping: { address: `${rnd(1, 200)}, ${pick(['MG Road', 'Park Street', 'Sector 21', 'Civil Lines', 'Lake View'])}`, city, state, pincode, country: 'India' },
        lines,
        subtotalPaise,
        discountPaise,
        deliveryFeePaise,
        taxPaise: 0,
        totalPaise,
        commissionPercent: config.commissionPercent,
        commissionPaise: split.commissionPaise,
        vendorPaise: split.vendorPaise,
        status,
        paymentMethod,
        paymentStatus,
        timeline,
        placedAt,
        updatedAt: timeline[timeline.length - 1].at,
        deliveryEta: status === 'delivered' ? null : hoursFromNow(rnd(6, 72)),
        notes: '',
      };
      orders.push(order);
      vendor.orderCount += 1;

      if (status === 'delivered') {
        vendor.balance.earnedPaise += order.vendorPaise;
        vendor.balance.commissionPaise += order.commissionPaise;
        ledger.push({
          id: `led_${order.id}`,
          kind: 'order_settlement',
          vendorId: vendor.id,
          orderId: order.id,
          creditPaise: order.vendorPaise,
          debitPaise: 0,
          commissionPaise: order.commissionPaise,
          note: `Settlement for ${order.orderNumber}`,
          at: timeline[timeline.length - 1].at,
        });
      } else if (!['cancelled', 'refunded'].includes(status)) {
        vendor.balance.pendingPaise += order.vendorPaise;
      }
    }
  }

  // Withdrawal history — reduces available balance, keeps numbers consistent.
  const withdrawals = [];
  for (const vendor of vendors.filter((v) => v.status === 'active')) {
    const earned = vendor.balance.earnedPaise;
    const paidAmount = Math.round(earned * 0.35);
    const inTransit = Math.round(earned * 0.2);
    if (paidAmount > 0) {
      withdrawals.push(makeWithdrawal(vendor, paidAmount, 'paid', daysAgo(21), 'HDFC Bank •••• 4421'));
      vendor.balance.withdrawnPaise += paidAmount;
    }
    if (inTransit > 0) {
      withdrawals.push(makeWithdrawal(vendor, inTransit, 'processing', daysAgo(3), 'UPI • payee@okhdfc'));
    }
    vendor.balance.availablePaise = Math.max(0, earned - vendor.balance.withdrawnPaise - inTransit);
  }

  // Deposits
  const deposits = [];
  for (const vendor of vendors) {
    if (vendor.depositPaidAt) {
      deposits.push({
        id: `dep_${vendor.slug}`,
        vendorId: vendor.id,
        userId: `usr_${vendor.slug}`,
        amountPaise: config.depositPaise,
        status: 'approved',
        method: 'upi',
        reference: `TXN${rnd(100000, 999999)}`,
        initiatedAt: vendor.depositPaidAt,
        confirmedAt: vendor.depositPaidAt,
        note: 'Refundable security deposit',
        createdAt: vendor.depositPaidAt,
      });
    } else {
      deposits.push({
        id: `dep_${vendor.slug}`,
        vendorId: vendor.id,
        userId: `usr_${vendor.slug}`,
        amountPaise: config.depositPaise,
        status: 'pending',
        method: null,
        reference: null,
        initiatedAt: null,
        confirmedAt: null,
        note: 'Awaiting payment',
        createdAt: vendor.createdAt,
      });
    }
  }

  // Notifications
  const tm = vendors.find((v) => v.slug === 'techmart');
  const recent = orders.filter((o) => o.vendorId === tm.id).slice(0, 6);
  notifications.push({
    id: 'ntf_welcome',
    userId: 'usr_techmart',
    vendorId: tm.id,
    type: 'system',
    title: 'Store activated 🎉',
    body: 'TechMart Electronics is live at techmart.growbusinessonline.com.',
    link: 'admin/settings.html',
    meta: {},
    readAt: null,
    createdAt: tm.activatedAt,
  });
  recent.forEach((o, i) => {
    notifications.push({
      id: `ntf_ord_${i}`,
      userId: 'usr_techmart',
      vendorId: tm.id,
      type: 'order',
      title: i === 0 ? 'New order received' : `Order ${o.orderNumber} updated`,
      body: `${o.customer.name} • ${o.lines.length} item(s) • ₹${(o.totalPaise / 100).toLocaleString('en-IN')}`,
      link: `admin/order-detail.html?id=${o.id}`,
      meta: { orderId: o.id },
      readAt: i > 2 ? daysAgo(i) : null,
      createdAt: o.placedAt,
    });
  });
  notifications.push({
    id: 'ntf_pay',
    userId: 'usr_techmart',
    vendorId: tm.id,
    type: 'payment',
    title: 'Withdrawal approved',
    body: 'Your payout has been approved and will reach your bank in 1-2 working days.',
    link: 'admin/withdrawals.html',
    meta: {},
    readAt: daysAgo(20),
    createdAt: daysAgo(21),
  });
  notifications.push({
    id: 'ntf_admin',
    userId: null,
    vendorId: null,
    type: 'announcement',
    title: 'Platform update',
    body: 'Analytics now includes a 90 day revenue comparison and top product trends.',
    link: '',
    meta: {},
    readAt: null,
    createdAt: daysAgo(4),
  });

  const messages = [
    {
      id: 'msg_1',
      name: 'Rohit Malhotra',
      email: 'rohit@example.com',
      phone: '+91 98111 22334',
      subject: 'Interested in the vendor plan',
      message: 'I run a small electronics shop in Karnal and want to move online. Is the ₹1,000 deposit really refundable?',
      status: 'new',
      createdAt: daysAgo(1),
    },
    {
      id: 'msg_2',
      name: 'Fatima Sheikh',
      email: 'fatima@example.com',
      phone: '+91 90040 55667',
      subject: 'Custom domain question',
      message: 'Can I point my own domain to my store later on?',
      status: 'read',
      createdAt: daysAgo(4),
    },
  ];

  const addresses = [
    {
      id: 'adr_1',
      userId: customerUser.id,
      label: 'Home',
      name: customerUser.name,
      phone: customerUser.phone,
      line1: '504, Prestige Sunberry, Marathahalli',
      city: 'Bengaluru',
      state: 'Karnataka',
      pincode: '560034',
      country: 'India',
      isDefault: true,
      createdAt: daysAgo(60),
    },
    {
      id: 'adr_2',
      userId: customerUser.id,
      label: 'Office',
      name: customerUser.name,
      phone: customerUser.phone,
      line1: 'Level 6, WeWork Galaxy, Residency Road',
      city: 'Bengaluru',
      state: 'Karnataka',
      pincode: '560025',
      country: 'India',
      isDefault: false,
      createdAt: daysAgo(40),
    },
  ];

  const wishlists = [
    { id: 'wsh_1', userId: customerUser.id, productId: 'prd_techmart_9', vendorId: 'vnd_techmart', createdAt: daysAgo(5) },
    { id: 'wsh_2', userId: customerUser.id, productId: 'prd_stylehub_5', vendorId: 'vnd_stylehub', createdAt: daysAgo(9) },
  ];

  return { orders, customers, notifications, ledger, withdrawals, deposits, messages, addresses, wishlists };
}

function makeWithdrawal(vendor, amountPaise, status, at, method) {
  return {
    id: `wth_${vendor.slug}_${status}`,
    vendorId: vendor.id,
    userId: `usr_${vendor.slug}`,
    amountPaise,
    status,
    method: method.startsWith('UPI') ? 'upi' : 'bank',
    account: method,
    ifsc: method.startsWith('UPI') ? '' : 'HDFC0001234',
    requestedAt: at,
    processedAt: status === 'paid' ? daysAgo(18) : null,
    reference: status === 'paid' ? `PAYOUT${rnd(10000, 99999)}` : null,
    note: status === 'processing' ? 'Sent to payment partner for verification.' : '',
    createdAt: at,
  };
}

/* ----------------------------------------------------------------------- main */

function build() {
  const base = buildVendors();
  const extra = buildOrders(base);
  const platform = {
    commissionPercent: config.commissionPercent,
    depositPaise: config.depositPaise,
    activationHours: config.activationHours,
    currency: config.currency,
    rootDomain: config.rootDomain,
    supportEmail: 'support@growbusinessonline.com',
    supportPhone: '+91 90000 00001',
    address: 'GrowBusiness Online, Sector 14, Jhajjar, Haryana 124103, India',
    deliveryFeePaise: config.deliveryFeePaise,
    freeDeliveryAbovePaise: config.freeDeliveryAbovePaise,
    gstPercent: config.gstPercent,
    paymentMethods: [
      { id: 'upi', label: 'UPI / Google Pay / PhonePe', kind: 'online', enabled: true, note: 'Instant confirmation' },
      { id: 'card', label: 'Credit / Debit Card', kind: 'online', enabled: true, note: 'Visa, Mastercard, RuPay' },
      { id: 'netbanking', label: 'Net Banking', kind: 'online', enabled: true, note: 'All major banks' },
      { id: 'cod', label: 'Cash on Delivery', kind: 'offline', enabled: true, note: 'Pay when it arrives' },
    ],
    withdrawalMethods: [
      { id: 'bank', label: 'Bank transfer (NEFT/IMPS)' },
      { id: 'upi', label: 'UPI ID' },
    ],
    minWithdrawalPaise: 50000,
    payoutDays: '1-2 working days',
  };

  return {
    users: base.users, // buildOrders() pushes the customer + admin onto this same array
    vendors: base.vendors,
    categories: base.categories,
    products: base.products,
    reviews: base.reviews,
    orders: extra.orders,
    customers: extra.customers,
    notifications: extra.notifications,
    ledger: extra.ledger,
    withdrawals: extra.withdrawals,
    deposits: extra.deposits,
    messages: extra.messages,
    addresses: extra.addresses,
    wishlists: extra.wishlists,
    meta: [{ key: 'platform', value: platform }],
  };
}

function seed({ force = false, wipe = false } = {}) {
  const current = db.load();
  const hasData = current.users.length > 0 || current.vendors.length > 0;
  if (hasData && !force && !wipe) {
    console.log('[seed] Database already has data — skipping. Use `npm run reset` to rebuild it.');
    return current;
  }
  const next = build();
  const fresh = db.replaceAll(next);
  db.persist(true);
  console.log(
    `[seed] Wrote ${fresh.users.length} users, ${fresh.vendors.length} vendors, ${fresh.products.length} products, ${fresh.orders.length} orders.`
  );
  return fresh;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.includes('--wipe') && fs.existsSync(config.paths.dbFile)) {
    fs.rmSync(config.paths.dbFile);
    console.log('[seed] Removed existing db.json');
  }
  seed({ force: args.includes('--force'), wipe: args.includes('--wipe') });
}

module.exports = { seed, build };
