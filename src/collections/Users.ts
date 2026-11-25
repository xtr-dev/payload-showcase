import type { CollectionConfig } from 'payload'

import { adminOrSelf, anyone, getUser, isAdmin, isAdminField, isAdminUser } from '@/access'

export const Users: CollectionConfig = {
  slug: 'users',
  admin: {
    useAsTitle: 'email',
    defaultColumns: ['name', 'email', 'role', 'membershipStatus'],
    group: 'People',
  },
  auth: {
    // Seven days, so members stay signed in to the account area between visits.
    tokenExpiration: 60 * 60 * 24 * 7,
  },
  access: {
    // Only admins may use the Payload admin panel; members use the site's account area.
    admin: ({ req }) => isAdminUser(getUser(req)),
    // Public sign-up is allowed. The `role` field below can only be set by admins, so a
    // self-registered user always becomes a member.
    create: anyone,
    read: adminOrSelf,
    update: adminOrSelf,
    delete: isAdmin,
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
    },
    {
      name: 'role',
      type: 'select',
      required: true,
      defaultValue: 'member',
      options: [
        { label: 'Admin', value: 'admin' },
        { label: 'Member', value: 'member' },
      ],
      saveToJWT: true,
      access: {
        create: isAdminField,
        update: isAdminField,
      },
      admin: { position: 'sidebar' },
    },
    {
      type: 'collapsible',
      label: 'Studio membership',
      fields: [
        {
          name: 'membershipPlan',
          type: 'relationship',
          relationTo: 'membership-plans',
          access: { create: isAdminField, update: isAdminField },
        },
        {
          name: 'membershipStatus',
          type: 'select',
          defaultValue: 'none',
          options: [
            { label: 'None', value: 'none' },
            { label: 'Pending payment', value: 'pending' },
            { label: 'Active', value: 'active' },
            { label: 'Cancelled', value: 'cancelled' },
          ],
          access: { create: isAdminField, update: isAdminField },
        },
        {
          name: 'membershipRenewsAt',
          type: 'date',
          access: { create: isAdminField, update: isAdminField },
        },
      ],
    },
  ],
}
