import {deviceApprovals} from '../_lib/deviceApprovals.js';
export const onRequestGet=({env,request})=>deviceApprovals({env,request});
